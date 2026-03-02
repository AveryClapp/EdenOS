import json
import anthropic
from sqlalchemy.orm import Session

from backend.config import settings
from backend.intelligence.context import build_context_snapshot
from backend.intelligence.prompts import SYSTEM_PROMPT, PLAN_DAY_SYSTEM_PROMPT, EDEN_TOOLS, format_chat_prompt, format_plan_day_prompt


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

    def chat(self, user_message: str, db: Session, now=None) -> dict:
        """
        Send a user message to the LLM with full context and tools injected.
        Returns a dict with 'reasoning', 'content', and 'tool_uses' keys.
        tool_uses is a list of {id, name, input} dicts — NOT executed here.
        """
        snapshot = build_context_snapshot(db, now=now)
        prompt = format_chat_prompt(user_message, snapshot)

        response = self._client.messages.create(
            model=settings.llm_model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
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

    def get_alerts(self, db: Session, now=None) -> list[dict]:
        """
        Return proactive alerts from the context snapshot.
        Does NOT call the LLM — alerts are rule-based from the context builder.
        """
        snapshot = build_context_snapshot(db, now=now)
        return snapshot.get("alerts", [])
