import json
import uuid
from datetime import datetime

import anthropic
from sqlalchemy.orm import Session

from backend.models.user_memory import UserMemory

_VALID_CATEGORIES = {"preference", "constraint", "goal_context", "personal", "signal"}

_EXTRACTION_PROMPT = """You are analyzing a conversation between a user and Eden (an AI scheduling assistant).
Extract any facts worth remembering about the user — preferences, constraints, personal context, goals, or emotional signals.

Return a JSON array of objects. Each object must have:
- "category": one of "preference", "constraint", "goal_context", "personal", "signal"
- "content": a concise, third-person statement of the fact (e.g. "prefers morning deep work")
- "confidence": float 0.0–1.0

If nothing worth remembering was said, return an empty array: []

Only extract facts that are stable and would affect scheduling decisions. Do not extract one-time events or generic pleasantries.

Conversation:
User: {user_message}
Eden: {assistant_response}

Return only the JSON array, no other text."""


def extract_memories_from_conversation(
    user_message: str,
    assistant_response: str,
    db: Session,
) -> list[UserMemory]:
    client = anthropic.Anthropic()
    prompt = _EXTRACTION_PROMPT.format(
        user_message=user_message,
        assistant_response=assistant_response,
    )
    for attempt in range(2):
        try:
            msg = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=512,
                messages=[{"role": "user", "content": prompt}],
            )
            text = next((b.text for b in msg.content if b.type == "text"), "[]")
            facts = json.loads(text)
            break
        except Exception:
            if attempt == 1:
                return []

    created = []
    for fact in facts:
        if not isinstance(fact, dict):
            continue
        category = fact.get("category", "")
        content = fact.get("content", "").strip()
        confidence = float(fact.get("confidence", 0.8))
        if category not in _VALID_CATEGORIES or not content:
            continue
        mem = UserMemory(
            id=str(uuid.uuid4()),
            category=category,
            content=content,
            confidence=min(1.0, max(0.0, confidence)),
            source="chat",
            created_at=datetime.utcnow(),
        )
        db.add(mem)
        created.append(mem)

    if created:
        db.commit()
    return created
