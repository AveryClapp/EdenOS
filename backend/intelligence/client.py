import json
import anthropic
from sqlalchemy.orm import Session

from backend.config import settings
from backend.intelligence.context import build_context_snapshot
from backend.intelligence.prompts import SYSTEM_PROMPT, SESSION_OPEN_PROMPT, PLAN_DAY_SYSTEM_PROMPT, EDEN_TOOLS, format_chat_prompt, format_plan_day_prompt


class EdenClient:
    """
    Claude API client for Eden's reasoning layer.

    Rules (from CLAUDE.md):
    - Never call the API without a full context snapshot.
    - Every response must include a 'reasoning' field.
    - Prompts live in prompts.py — never inline here.
    - Never make live API calls in tests (mock anthropic.Anthropic).
    """

    def __init__(self):
        self._client = anthropic.Anthropic(api_key=settings.anthropic_api_key)

    SESSION_OPEN_TOKEN = "__session_open__"

    def chat_stream(self, user_message: str, db: Session, now=None):
        """
        Generator that yields plain-text chunks from the LLM.
        Text-only — no tool use. Use chat() when tools are needed.
        """
        snapshot = build_context_snapshot(db, now=now)

        if user_message == self.SESSION_OPEN_TOKEN:
            system = SYSTEM_PROMPT + "\n\n" + SESSION_OPEN_PROMPT
            prompt = format_chat_prompt("Open a new session. Greet the user based on the temporal context.", snapshot)
        else:
            system = SYSTEM_PROMPT
            prompt = format_chat_prompt(user_message, snapshot)

        with self._client.messages.stream(
            model=settings.llm_model,
            max_tokens=2048,
            system=system,
            messages=[{"role": "user", "content": prompt}],
        ) as stream:
            for text in stream.text_stream:
                yield text

    def chat(self, user_message: str, db: Session, now=None) -> dict:
        """
        Send a user message to the LLM with full context and tools injected.
        Returns a dict with 'reasoning', 'content', and 'tool_uses' keys.
        tool_uses is a list of {id, name, input} dicts — NOT executed here.

        If user_message == SESSION_OPEN_TOKEN, uses SESSION_OPEN_PROMPT to
        generate Eden's temporal-aware opening message.
        """
        snapshot = build_context_snapshot(db, now=now)

        if user_message == self.SESSION_OPEN_TOKEN:
            system = SYSTEM_PROMPT + "\n\n" + SESSION_OPEN_PROMPT
            prompt = format_chat_prompt("Open a new session. Greet the user based on the temporal context.", snapshot)
        else:
            system = SYSTEM_PROMPT
            prompt = format_chat_prompt(user_message, snapshot)

        response = self._client.messages.create(
            model=settings.llm_model,
            max_tokens=2048,
            system=system,
            tools=EDEN_TOOLS,
            messages=[{"role": "user", "content": prompt}],
        )

        content_text = ""
        tool_uses = []

        for block in response.content:
            if block.type == "text":
                raw = block.text.strip()
                if raw.startswith("```"):
                    raw = raw.split("\n", 1)[-1]
                    if raw.endswith("```"):
                        raw = raw[: raw.rfind("```")]
                    raw = raw.strip()
                # If it's JSON with content/reasoning keys, extract them
                try:
                    parsed = json.loads(raw)
                    if "content" in parsed:
                        content_text = parsed.get("content", "")
                        reasoning = parsed.get("reasoning", "")
                        continue
                except json.JSONDecodeError:
                    pass
                content_text += raw
            elif block.type == "tool_use":
                tool_uses.append({"id": block.id, "name": block.name, "input": block.input})

        return {
            "content": content_text,
            "reasoning": locals().get("reasoning", ""),
            "tool_uses": tool_uses,
        }

    def plan_day(self, intent: str, db: Session, now=None) -> dict:
        """
        Parse user's daily intent and return structured actions (create/use projects+tasks).
        Does NOT execute the actions — caller handles DB writes.
        """
        snapshot = build_context_snapshot(db, now=now)
        prompt = format_plan_day_prompt(intent, snapshot)

        response = self._client.messages.create(
            model=settings.llm_model,
            max_tokens=4096,
            system=PLAN_DAY_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[-1]
            if raw.endswith("```"):
                raw = raw[: raw.rfind("```")]
            raw = raw.strip()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return {"actions": [], "summary": raw, "reasoning": ""}

    def chat_planning(self, message: str, draft_blocks: list, plan_date: str, db) -> dict:
        from backend.intelligence.prompts import PLANNING_TOOLS, PLAN_GENERATION_PROMPT
        from backend.intelligence.context import build_context_snapshot
        import json

        snapshot = build_context_snapshot(db)
        context_str = json.dumps(snapshot, default=str, indent=2)

        user_content = f"""<context>
{context_str}
</context>

Current draft schedule for {plan_date}:
{json.dumps(draft_blocks)}

User request: {message}"""

        msg = self._client.messages.create(
            model="claude-opus-4-6",
            max_tokens=1024,
            system=PLAN_GENERATION_PROMPT,
            tools=PLANNING_TOOLS,
            messages=[{"role": "user", "content": user_content}],
        )

        content = ""
        tool_uses = []
        for block in msg.content:
            if block.type == "text":
                content = block.text
            elif block.type == "tool_use":
                tool_uses.append({"id": block.id, "name": block.name, "input": block.input})

        # Execute planning tool actions directly (no approval needed in planning mode)
        self._execute_planning_tools(tool_uses, plan_date, db)

        return {"content": content, "reasoning": "", "tool_uses": tool_uses}

    def _execute_planning_tools(self, tool_uses: list, plan_date: str, db) -> None:
        import uuid
        from datetime import time, date as _date
        from backend.models.schedule_block import ScheduleBlock

        target_date = _date.fromisoformat(plan_date)

        for tu in tool_uses:
            name = tu["name"]
            inp = tu["input"]

            if name == "move_block":
                block = db.get(ScheduleBlock, inp["block_id"])
                if block and block.is_draft:
                    h, m = inp["new_start_time"].split(":")
                    block.start_time = time(int(h), int(m))
                    h, m = inp["new_end_time"].split(":")
                    block.end_time = time(int(h), int(m))

            elif name == "add_block":
                h, m = inp["start_time"].split(":")
                st = time(int(h), int(m))
                h, m = inp["end_time"].split(":")
                et = time(int(h), int(m))
                block = ScheduleBlock(
                    id=str(uuid.uuid4()),
                    task_id=inp.get("task_id"),
                    date=target_date,
                    start_time=st,
                    end_time=et,
                    auto_generated=True,
                    overridden_by_user=False,
                    is_draft=True,
                )
                db.add(block)

            elif name == "remove_block":
                block = db.get(ScheduleBlock, inp["block_id"])
                if block and block.is_draft:
                    db.delete(block)

            elif name == "replace_task":
                block = db.get(ScheduleBlock, inp["block_id"])
                if block and block.is_draft:
                    block.task_id = inp["new_task_id"]

        db.commit()

    def get_alerts(self, db: Session, now=None) -> list[dict]:
        """
        Return proactive alerts from the context snapshot.
        Does NOT call the LLM — alerts are rule-based from the context builder.
        """
        snapshot = build_context_snapshot(db, now=now)
        return snapshot.get("alerts", [])
