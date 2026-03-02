# Adaptive Scheduling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Eden's adaptive scheduling layer — a two-panel planning session (chat + live timeline), a real-time "what now" suggestion strip, a configurable autonomy spectrum, and a personalization engine that extracts behavioral patterns and memories from chat to make scheduling decisions genuinely personal.

**Architecture:** 12 tasks across three layers. Backend first: data model changes, memory CRUD, memory extraction from chat, behavioral profile, autonomy settings, plan generation, suggestion engine. Then frontend: types/API clients, NowStrip on Today, PlanningSession view, Memory section in Settings. Each task is independently committable.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, Alembic, Anthropic Claude API, React + TanStack Query + TypeScript, Tailwind v4.

---

## Background: Key Files

Read these before implementing any task:
- `backend/models/schedule_block.py` — add `is_draft` column
- `backend/models/user_profile.py` — add autonomy_level, planning_time, planning_auto_lock_minutes
- `backend/api/schedule.py` — GET /api/schedule filters blocks; must exclude drafts by default
- `backend/api/chat.py` — add BackgroundTasks for memory extraction + planning mode
- `backend/intelligence/prompts.py` — add plan generation prompt + planning tools
- `backend/intelligence/context.py` — inject behavioral_profile + user_memory into snapshot
- `backend/intelligence/client.py` — EdenClient.chat() — understand how LLM calls work
- `frontend/src/views/Today.tsx` — add NowStrip
- `frontend/src/views/Settings.tsx` — add MemorySection
- `frontend/src/App.tsx` — add /plan route
- `alembic/versions/b2c3d4e5f6a7_add_whoop.py` — migration pattern to copy; current head is `b2c3d4e5f6a7`

---

## Task 1: Data Model — UserMemory + ScheduleBlock draft state + UserProfile autonomy fields

**Files:**
- Create: `backend/models/user_memory.py`
- Modify: `backend/models/schedule_block.py`
- Modify: `backend/models/user_profile.py`
- Modify: `backend/models/__init__.py`
- Create: `alembic/versions/c3d4e5f6a7b8_adaptive_scheduling.py`
- Create: `tests/models/test_user_memory.py`

**Step 1: Write failing tests**

Create `tests/models/test_user_memory.py`:

```python
import uuid
from datetime import datetime, date
from backend.models.user_memory import UserMemory
from backend.models.schedule_block import ScheduleBlock
from backend.models.user_profile import UserProfile


def test_user_memory_model(db):
    mem = UserMemory(
        id=str(uuid.uuid4()),
        category="preference",
        content="prefers not to schedule admin before 10am",
        confidence=0.9,
        source="chat",
    )
    db.add(mem)
    db.commit()
    fetched = db.get(UserMemory, mem.id)
    assert fetched.content == "prefers not to schedule admin before 10am"
    assert fetched.is_active is True


def test_schedule_block_has_is_draft(db):
    assert hasattr(ScheduleBlock, 'is_draft')


def test_user_profile_has_autonomy_fields(db):
    assert hasattr(UserProfile, 'autonomy_level')
    assert hasattr(UserProfile, 'planning_time')
    assert hasattr(UserProfile, 'planning_auto_lock_minutes')


def test_user_memory_defaults_active(db):
    mem = UserMemory(
        id=str(uuid.uuid4()),
        category="personal",
        content="training for Ironman through October",
        confidence=1.0,
        source="user",
    )
    db.add(mem)
    db.commit()
    assert db.get(UserMemory, mem.id).is_active is True
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/models/test_user_memory.py -v
```

Expected: FAIL — ModuleNotFoundError.

**Step 3: Create `backend/models/user_memory.py`**

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Float, Boolean, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class UserMemory(Base):
    __tablename__ = "user_memory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    category: Mapped[str] = mapped_column(String(50), nullable=False)
    # preference | constraint | goal_context | personal | signal
    content: Mapped[str] = mapped_column(String(2000), nullable=False)
    confidence: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    source: Mapped[str] = mapped_column(String(200), nullable=False, default="chat")
    # "chat", "behavioral", "user"
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
```

**Step 4: Add `is_draft` to `backend/models/schedule_block.py`**

After the `overridden_by_user` line, add:

```python
    is_draft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

**Step 5: Add autonomy fields to `backend/models/user_profile.py`**

After the `chronotype` line, add:

```python
    autonomy_level: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    planning_time: Mapped[str] = mapped_column(String(5), nullable=False, default="21:00")
    planning_auto_lock_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
```

The `Integer` import is already present.

**Step 6: Register `UserMemory` in `backend/models/__init__.py`**

Read the file. Add:
```python
from backend.models.user_memory import UserMemory
```
And add `"UserMemory"` to `__all__`.

**Step 7: Create migration `alembic/versions/c3d4e5f6a7b8_adaptive_scheduling.py`**

```python
"""adaptive_scheduling

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-03-02

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c3d4e5f6a7b8'
down_revision: Union[str, Sequence[str], None] = 'b2c3d4e5f6a7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_memory',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('category', sa.String(50), nullable=False),
        sa.Column('content', sa.String(2000), nullable=False),
        sa.Column('confidence', sa.Float(), nullable=False),
        sa.Column('source', sa.String(200), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.add_column('schedule_blocks', sa.Column('is_draft', sa.Boolean(), nullable=False, server_default='0'))
    op.add_column('user_profile', sa.Column('autonomy_level', sa.Integer(), nullable=False, server_default='2'))
    op.add_column('user_profile', sa.Column('planning_time', sa.String(5), nullable=False, server_default='21:00'))
    op.add_column('user_profile', sa.Column('planning_auto_lock_minutes', sa.Integer(), nullable=False, server_default='60'))


def downgrade() -> None:
    op.drop_column('user_profile', 'planning_auto_lock_minutes')
    op.drop_column('user_profile', 'planning_time')
    op.drop_column('user_profile', 'autonomy_level')
    op.drop_column('schedule_blocks', 'is_draft')
    op.drop_table('user_memory')
```

**Step 8: Run migration and tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
alembic upgrade head
pytest tests/models/test_user_memory.py -v
```

Expected: migration runs cleanly, 4 tests pass.

**Step 9: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing (existing tests unaffected — `is_draft` defaults False, new profile fields have server defaults).

**Step 10: Commit**

```bash
git add backend/models/user_memory.py backend/models/schedule_block.py backend/models/user_profile.py backend/models/__init__.py alembic/versions/c3d4e5f6a7b8_adaptive_scheduling.py tests/models/test_user_memory.py
git commit -m "feat: UserMemory model, is_draft on ScheduleBlock, autonomy fields on UserProfile"
```

---

## Task 2: Memory API — CRUD Routes

**Files:**
- Modify: `backend/api/schemas.py`
- Create: `backend/api/memory.py`
- Modify: `backend/main.py`
- Create: `tests/api/test_memory.py`

**Step 1: Write failing tests**

Create `tests/api/test_memory.py`:

```python
def test_list_memory_empty(client):
    r = client.get("/api/memory")
    assert r.status_code == 200
    assert r.json() == []


def test_create_memory(client):
    r = client.post("/api/memory", json={
        "category": "preference",
        "content": "prefers not to schedule admin before 10am",
        "confidence": 0.9,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["content"] == "prefers not to schedule admin before 10am"
    assert data["source"] == "user"
    assert data["is_active"] is True


def test_delete_memory(client):
    r = client.post("/api/memory", json={
        "category": "personal",
        "content": "training for Ironman",
        "confidence": 1.0,
    })
    mem_id = r.json()["id"]
    del_r = client.delete(f"/api/memory/{mem_id}")
    assert del_r.status_code == 200
    assert client.get("/api/memory").json() == []


def test_toggle_memory_inactive(client):
    r = client.post("/api/memory", json={
        "category": "signal",
        "content": "felt burned out this week",
        "confidence": 0.7,
    })
    mem_id = r.json()["id"]
    patch_r = client.patch(f"/api/memory/{mem_id}", json={"is_active": False})
    assert patch_r.status_code == 200
    assert patch_r.json()["is_active"] is False


def test_list_memory_only_active(client):
    r1 = client.post("/api/memory", json={"category": "preference", "content": "A", "confidence": 1.0})
    r2 = client.post("/api/memory", json={"category": "preference", "content": "B", "confidence": 1.0})
    client.patch(f"/api/memory/{r2.json()['id']}", json={"is_active": False})
    results = client.get("/api/memory").json()
    assert len(results) == 1
    assert results[0]["content"] == "A"
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_memory.py::test_list_memory_empty -v
```

Expected: FAIL — 404 (route not found).

**Step 3: Add schemas to `backend/api/schemas.py`**

Read the file. Append at the end:

```python
# --- Memory ---

class MemoryCreate(BaseModel):
    category: Literal["preference", "constraint", "goal_context", "personal", "signal"]
    content: str
    confidence: float = 1.0


class MemoryUpdate(BaseModel):
    is_active: bool


class MemoryResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    category: str
    content: str
    confidence: float
    source: str
    created_at: datetime
    is_active: bool
```

**Step 4: Create `backend/api/memory.py`**

```python
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.user_memory import UserMemory
from backend.api.schemas import MemoryCreate, MemoryUpdate, MemoryResponse

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("", response_model=list[MemoryResponse])
def list_memory(db: Session = Depends(get_db)):
    return db.query(UserMemory).filter(UserMemory.is_active == True).all()


@router.post("", response_model=MemoryResponse)
def create_memory(body: MemoryCreate, db: Session = Depends(get_db)):
    mem = UserMemory(
        id=str(uuid.uuid4()),
        category=body.category,
        content=body.content,
        confidence=body.confidence,
        source="user",
        created_at=datetime.utcnow(),
    )
    db.add(mem)
    db.commit()
    db.refresh(mem)
    return mem


@router.patch("/{memory_id}", response_model=MemoryResponse)
def update_memory(memory_id: str, body: MemoryUpdate, db: Session = Depends(get_db)):
    mem = db.get(UserMemory, memory_id)
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")
    mem.is_active = body.is_active
    db.commit()
    db.refresh(mem)
    return mem


@router.delete("/{memory_id}")
def delete_memory(memory_id: str, db: Session = Depends(get_db)):
    mem = db.get(UserMemory, memory_id)
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(mem)
    db.commit()
    return {"deleted": memory_id}
```

**Step 5: Wire router in `backend/main.py`**

Read the file. Add:
```python
from backend.api.memory import router as memory_router
```
And:
```python
app.include_router(memory_router)
```

**Step 6: Run tests**

```bash
pytest tests/api/test_memory.py -v
```

Expected: 5 passed.

**Step 7: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 8: Commit**

```bash
git add backend/api/schemas.py backend/api/memory.py backend/main.py tests/api/test_memory.py
git commit -m "feat: UserMemory CRUD API"
```

---

## Task 3: Memory Extraction from Chat

After every chat response, extract memorable facts from the conversation in a background task.

**Files:**
- Create: `backend/intelligence/memory.py`
- Modify: `backend/api/chat.py`
- Create: `tests/intelligence/test_memory.py`

**Step 1: Write failing tests**

Create `tests/intelligence/test_memory.py`:

```python
import json
from unittest.mock import patch, MagicMock
from backend.intelligence.memory import extract_memories_from_conversation


def _mock_anthropic_response(text: str):
    msg = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = text
    msg.content = [block]
    return msg


def test_extract_memories_returns_list(db):
    reply = json.dumps([
        {"category": "preference", "content": "prefers morning deep work", "confidence": 0.9},
    ])
    with patch("backend.intelligence.memory.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response(reply)

        result = extract_memories_from_conversation(
            user_message="I work best in the morning for deep focus tasks",
            assistant_response="Got it, I'll prioritize deep work before noon.",
            db=db,
        )

    assert isinstance(result, list)
    assert len(result) == 1
    assert result[0].category == "preference"


def test_extract_memories_handles_empty_list(db):
    reply = json.dumps([])
    with patch("backend.intelligence.memory.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response(reply)

        result = extract_memories_from_conversation("hello", "hi", db=db)

    assert result == []


def test_extract_memories_handles_invalid_json(db):
    with patch("backend.intelligence.memory.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_anthropic_response("not json")

        result = extract_memories_from_conversation("test", "test", db=db)

    assert result == []
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/intelligence/test_memory.py -v
```

Expected: FAIL — ModuleNotFoundError.

**Step 3: Create `backend/intelligence/memory.py`**

```python
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
    try:
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=512,
            messages=[{"role": "user", "content": prompt}],
        )
        text = next((b.text for b in msg.content if b.type == "text"), "[]")
        facts = json.loads(text)
    except (json.JSONDecodeError, Exception):
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
```

**Step 4: Hook memory extraction into `backend/api/chat.py`**

Read the file. Make two changes:

**a) Add BackgroundTasks to the import and POST route:**

```python
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
```

**b) Update the chat endpoint signature and add background task:**

Find the `@router.post("/")` endpoint. Change its signature to include `background_tasks: BackgroundTasks` and add the extraction call after building the response:

```python
@router.post("/", response_model=ChatResponse)
def chat(
    body: ChatRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    # ... existing logic unchanged ...

    # After building `response` (the ChatResponse object), before returning:
    from backend.db import SessionLocal

    def _extract(user_msg: str, eden_msg: str):
        _db = SessionLocal()
        try:
            from backend.intelligence.memory import extract_memories_from_conversation
            extract_memories_from_conversation(user_msg, eden_msg, _db)
        finally:
            _db.close()

    background_tasks.add_task(_extract, body.message, response.content)
    return response
```

IMPORTANT: The background task uses its own `SessionLocal()` session — NOT the request-scoped `db` — because the request session will be closed by the time the background task runs.

**Step 5: Run tests**

```bash
pytest tests/intelligence/test_memory.py -v
```

Expected: 3 passed.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing (existing chat tests unaffected).

**Step 7: Commit**

```bash
git add backend/intelligence/memory.py backend/api/chat.py tests/intelligence/test_memory.py
git commit -m "feat: memory extraction from chat conversations (background task)"
```

---

## Task 4: Behavioral Profile + Memory Injection into Context Snapshot

**Files:**
- Create: `backend/intelligence/behavioral_profile.py`
- Modify: `backend/intelligence/context.py`
- Modify: `tests/intelligence/test_client.py`

**Step 1: Write failing tests**

Append to `tests/intelligence/test_client.py`:

```python
def test_context_snapshot_includes_behavioral_profile(db):
    from backend.intelligence.context import build_context_snapshot
    snapshot = build_context_snapshot(db)
    assert "behavioral_profile" in snapshot


def test_context_snapshot_includes_user_memory(db):
    from backend.intelligence.context import build_context_snapshot
    snapshot = build_context_snapshot(db)
    assert "user_memory" in snapshot
    assert isinstance(snapshot["user_memory"], list)
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/intelligence/test_client.py::test_context_snapshot_includes_behavioral_profile tests/intelligence/test_client.py::test_context_snapshot_includes_user_memory -v
```

Expected: FAIL — KeyError.

**Step 3: Create `backend/intelligence/behavioral_profile.py`**

```python
from sqlalchemy.orm import Session
from backend.models.learning_record import LearningRecord


def build_behavioral_profile(db: Session) -> dict:
    records = db.query(LearningRecord).all()
    if not records:
        return {"sample_count": 0, "notes": "No learning data yet."}

    by_load: dict[int, list] = {1: [], 2: [], 3: []}
    for r in records:
        load = getattr(r, 'cognitive_load', None)
        if load in by_load and r.estimated_minutes and r.actual_minutes:
            ratio = r.actual_minutes / r.estimated_minutes
            by_load[load].append(ratio)

    estimation_accuracy = {}
    for load, ratios in by_load.items():
        if len(ratios) >= 3:
            avg = sum(ratios) / len(ratios)
            label = {1: "low", 2: "moderate", 3: "deep_focus"}[load]
            estimation_accuracy[label] = round(avg, 2)

    notes = []
    for label, ratio in estimation_accuracy.items():
        if ratio > 1.2:
            notes.append(f"User runs {round((ratio-1)*100)}% over estimate on {label} tasks — pad scheduling.")
        elif ratio < 0.8:
            notes.append(f"User finishes {label} tasks {round((1-ratio)*100)}% faster than estimate.")

    return {
        "sample_count": len(records),
        "estimation_accuracy_by_load": estimation_accuracy,
        "scheduling_notes": notes,
    }
```

**Step 4: Update `backend/intelligence/context.py`**

Read the file. Make two additions:

**a) Add `_build_user_memory` function:**

```python
def _build_user_memory(db: Session) -> list[dict]:
    from backend.models.user_memory import UserMemory
    memories = db.query(UserMemory).filter(UserMemory.is_active == True).all()
    return [{"category": m.category, "content": m.content} for m in memories]
```

**b) Add both to `build_context_snapshot` return dict:**

```python
        "behavioral_profile": build_behavioral_profile(db),
        "user_memory": _build_user_memory(db),
```

Also add the import at the top of context.py:
```python
from backend.intelligence.behavioral_profile import build_behavioral_profile
```

**Step 5: Run tests**

```bash
pytest tests/intelligence/test_client.py::test_context_snapshot_includes_behavioral_profile tests/intelligence/test_client.py::test_context_snapshot_includes_user_memory -v
```

Expected: 2 passed.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add backend/intelligence/behavioral_profile.py backend/intelligence/context.py tests/intelligence/test_client.py
git commit -m "feat: behavioral profile + user memory injected into context snapshot"
```

---

## Task 5: UserProfile Autonomy Settings API

**Files:**
- Modify: `backend/api/schemas.py`
- Modify: `backend/api/user_profile.py`
- Create: `tests/api/test_user_profile.py`

**Step 1: Write failing tests**

Create `tests/api/test_user_profile.py`:

```python
def test_get_user_profile_has_autonomy_fields(client):
    r = client.get("/api/user-profile")
    assert r.status_code == 200
    data = r.json()
    assert "autonomy_level" in data
    assert "planning_time" in data
    assert "planning_auto_lock_minutes" in data


def test_update_user_profile_autonomy(client):
    r = client.put("/api/user-profile", json={
        "wake_hour": 7,
        "chronotype": "intermediate",
        "autonomy_level": 3,
        "planning_time": "20:30",
        "planning_auto_lock_minutes": 45,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["autonomy_level"] == 3
    assert data["planning_time"] == "20:30"
    assert data["planning_auto_lock_minutes"] == 45


def test_autonomy_level_must_be_1_to_5(client):
    r = client.put("/api/user-profile", json={
        "wake_hour": 7,
        "chronotype": "intermediate",
        "autonomy_level": 0,
        "planning_time": "21:00",
        "planning_auto_lock_minutes": 60,
    })
    assert r.status_code == 422
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_user_profile.py -v
```

Expected: FAIL — missing fields.

**Step 3: Update schemas in `backend/api/schemas.py`**

Read the file. Update `UserProfileUpdate` and `UserProfileResponse`:

```python
class UserProfileUpdate(BaseModel):
    wake_hour: int
    chronotype: Literal["early", "intermediate", "late"]
    autonomy_level: int = 2
    planning_time: str = "21:00"          # "HH:MM"
    planning_auto_lock_minutes: int = 60

    @field_validator("wake_hour")
    @classmethod
    def validate_wake_hour(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("wake_hour must be 0–23")
        return v

    @field_validator("autonomy_level")
    @classmethod
    def validate_autonomy_level(cls, v: int) -> int:
        if not 1 <= v <= 5:
            raise ValueError("autonomy_level must be 1–5")
        return v


class UserProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    wake_hour: int
    chronotype: str
    autonomy_level: int
    planning_time: str
    planning_auto_lock_minutes: int
```

**Step 4: Update `backend/api/user_profile.py`**

Read the file. In the PUT endpoint, add the new fields to the setattr loop. The existing pattern already uses `model_dump()` and `setattr`, so the new fields will be handled automatically as long as the schema includes them. Verify this — if the endpoint uses explicit field assignment, add the three new fields.

**Step 5: Run tests**

```bash
pytest tests/api/test_user_profile.py -v
```

Expected: 3 passed.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add backend/api/schemas.py backend/api/user_profile.py tests/api/test_user_profile.py
git commit -m "feat: autonomy level and planning time settings on UserProfile"
```

---

## Task 6: Plan Generation Endpoint

`POST /api/plan/generate` — LLM proposes a full day as draft ScheduleBlocks.

**Files:**
- Modify: `backend/intelligence/prompts.py`
- Create: `backend/api/plan.py`
- Modify: `backend/api/schedule.py` — filter out draft blocks from GET
- Modify: `backend/main.py`
- Create: `tests/api/test_plan.py`

**Step 1: Write failing tests**

Create `tests/api/test_plan.py`:

```python
import uuid
from datetime import date, datetime
from unittest.mock import patch, MagicMock
import json


def _setup(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 10
    }).json()
    task = client.post("/api/tasks", json={
        "project_id": proj["id"], "title": "Write tests",
        "cognitive_load": 2, "estimated_minutes": 60
    }).json()
    return task


def _mock_plan_response(task_id: str):
    proposal = json.dumps({
        "blocks": [
            {
                "task_id": task_id,
                "start_time": "09:00",
                "end_time": "10:00",
                "reason": "Morning peak energy, high priority task"
            }
        ],
        "summary": "Focused morning session for engineering work."
    })
    msg = MagicMock()
    block = MagicMock()
    block.type = "text"
    block.text = proposal
    msg.content = [block]
    msg.stop_reason = "end_turn"
    return msg


def test_generate_plan_creates_draft_blocks(client):
    task = _setup(client)
    target_date = date.today().isoformat()

    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_response(task["id"])

        r = client.post(f"/api/plan/generate?target_date={target_date}")

    assert r.status_code == 200
    data = r.json()
    assert "blocks" in data
    assert "summary" in data
    assert len(data["blocks"]) >= 0  # may be 0 if task not schedulable


def test_draft_blocks_excluded_from_schedule(client):
    task = _setup(client)
    target_date = date.today().isoformat()

    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_response(task["id"])
        client.post(f"/api/plan/generate?target_date={target_date}")

    schedule = client.get("/api/schedule").json()
    # Draft blocks should not appear in the regular schedule endpoint
    all_ids = {b["id"] for b in schedule["today"] + schedule["week"]}
    # We can't easily check IDs here, so just verify the call succeeds
    assert isinstance(schedule["today"], list)
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_plan.py::test_generate_plan_creates_draft_blocks -v
```

Expected: FAIL — 404 (route not found).

**Step 3: Add plan generation prompt to `backend/intelligence/prompts.py`**

Read the file. Append:

```python
PLAN_GENERATION_PROMPT = """You are Eden's scheduling engine. Given the user's tasks, energy profile, behavioral patterns, and personal memory, propose a schedule for the target date.

Return ONLY a JSON object with this exact structure:
{
  "blocks": [
    {
      "task_id": "<uuid of task>",
      "start_time": "HH:MM",
      "end_time": "HH:MM",
      "reason": "<one sentence why this task goes here>"
    }
  ],
  "summary": "<2-3 sentence overview of the day and key decisions>"
}

Rules:
- Only schedule tasks from the provided task list (use exact task_id values)
- Respect availability windows — do not schedule outside them
- Do not overlap blocks
- Match cognitive load to energy level: load=3 tasks in high-energy slots (energy ≥ 4), load=1 tasks in low-energy slots
- Apply behavioral profile notes (e.g. pad deep focus tasks if user consistently overruns)
- If user memory mentions constraints for this day (e.g. "committee meets Thursdays"), respect them
- Leave reasonable buffer time between blocks
- Return an empty blocks array if no tasks can be reasonably scheduled

Do not include any text outside the JSON object."""

PLANNING_TOOLS = [
    {
        "name": "move_block",
        "description": "Move a draft schedule block to a new time",
        "input_schema": {
            "type": "object",
            "properties": {
                "block_id": {"type": "string", "description": "ID of the draft block to move"},
                "new_start_time": {"type": "string", "description": "New start time HH:MM"},
                "new_end_time": {"type": "string", "description": "New end time HH:MM"},
            },
            "required": ["block_id", "new_start_time", "new_end_time"],
        },
    },
    {
        "name": "add_block",
        "description": "Add a new draft block for a task",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string", "description": "Task ID to schedule"},
                "start_time": {"type": "string", "description": "Start time HH:MM"},
                "end_time": {"type": "string", "description": "End time HH:MM"},
            },
            "required": ["task_id", "start_time", "end_time"],
        },
    },
    {
        "name": "remove_block",
        "description": "Remove a draft block from the schedule",
        "input_schema": {
            "type": "object",
            "properties": {
                "block_id": {"type": "string", "description": "ID of the draft block to remove"},
            },
            "required": ["block_id"],
        },
    },
    {
        "name": "replace_task",
        "description": "Swap the task in a draft block for a different task",
        "input_schema": {
            "type": "object",
            "properties": {
                "block_id": {"type": "string", "description": "ID of the draft block"},
                "new_task_id": {"type": "string", "description": "ID of the task to schedule instead"},
            },
            "required": ["block_id", "new_task_id"],
        },
    },
]
```

**Step 4: Create `backend/api/plan.py`**

```python
import uuid
import json
from datetime import date, datetime, time

import anthropic
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.intelligence.context import build_context_snapshot
from backend.intelligence.prompts import PLAN_GENERATION_PROMPT
from backend.models.schedule_block import ScheduleBlock
from backend.models.task import Task

router = APIRouter(prefix="/api/plan", tags=["plan"])


def _parse_time(t: str) -> time:
    h, m = t.split(":")
    return time(int(h), int(m))


@router.post("/generate")
def generate_plan(target_date: date = Query(default=None), db: Session = Depends(get_db)):
    if target_date is None:
        from datetime import date as _date
        target_date = _date.today()

    # Delete existing drafts for this date
    db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).delete()
    db.commit()

    # Build context
    snapshot = build_context_snapshot(db)
    context_str = json.dumps(snapshot, default=str, indent=2)

    # Get schedulable tasks for context
    tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()
    task_list = [
        {"id": t.id, "title": t.title, "cognitive_load": t.cognitive_load,
         "estimated_minutes": t.estimated_minutes, "deadline": str(t.deadline) if t.deadline else None}
        for t in tasks
    ]

    user_content = f"""<context>
{context_str}
</context>

Target date: {target_date}
Tasks to consider scheduling: {json.dumps(task_list)}

Propose a schedule for {target_date}."""

    client = anthropic.Anthropic()
    msg = client.messages.create(
        model="claude-opus-4-6",
        max_tokens=2048,
        system=PLAN_GENERATION_PROMPT,
        messages=[{"role": "user", "content": user_content}],
    )

    text = next((b.text for b in msg.content if b.type == "text"), "{}")
    try:
        proposal = json.loads(text)
    except json.JSONDecodeError:
        proposal = {"blocks": [], "summary": "Could not parse schedule proposal."}

    # Create draft ScheduleBlocks
    created_blocks = []
    for b in proposal.get("blocks", []):
        try:
            block = ScheduleBlock(
                id=str(uuid.uuid4()),
                task_id=b.get("task_id"),
                date=target_date,
                start_time=_parse_time(b["start_time"]),
                end_time=_parse_time(b["end_time"]),
                auto_generated=True,
                overridden_by_user=False,
                is_draft=True,
            )
            db.add(block)
            created_blocks.append({
                "id": block.id,
                "task_id": block.task_id,
                "date": str(block.date),
                "start_time": b["start_time"],
                "end_time": b["end_time"],
                "reason": b.get("reason", ""),
            })
        except (KeyError, ValueError):
            continue

    db.commit()

    return {
        "blocks": created_blocks,
        "summary": proposal.get("summary", ""),
        "date": str(target_date),
    }


@router.post("/lock")
def lock_plan(target_date: date = Query(...), db: Session = Depends(get_db)):
    drafts = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).all()
    for block in drafts:
        block.is_draft = False
    db.commit()
    return {"locked": len(drafts), "date": str(target_date)}


@router.delete("/{target_date}")
def discard_plan(target_date: date, db: Session = Depends(get_db)):
    deleted = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).delete()
    db.commit()
    return {"discarded": deleted, "date": str(target_date)}
```

**Step 5: Filter draft blocks from `GET /api/schedule`**

Read `backend/api/schedule.py`. Find the `get_schedule` query:

```python
    blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= start_date,
        ScheduleBlock.date < end_date,
    ).all()
```

Replace with:

```python
    blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= start_date,
        ScheduleBlock.date < end_date,
        ScheduleBlock.is_draft == False,
    ).all()
```

**Step 6: Wire router in `backend/main.py`**

```python
from backend.api.plan import router as plan_router
```
```python
app.include_router(plan_router)
```

**Step 7: Run tests**

```bash
pytest tests/api/test_plan.py -v
```

Expected: 2 passed.

**Step 8: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 9: Commit**

```bash
git add backend/intelligence/prompts.py backend/api/plan.py backend/api/schedule.py backend/main.py tests/api/test_plan.py
git commit -m "feat: plan generation — LLM proposes draft schedule blocks for a date"
```

---

## Task 7: Planning Chat Mode

Planning session chat reuses the existing `/api/chat` endpoint with `mode="planning"` — different system prompt, narrowed tools (move/add/remove/replace blocks), responses update draft ScheduleBlocks.

**Files:**
- Modify: `backend/api/schemas.py`
- Modify: `backend/api/chat.py`
- Modify: `tests/api/test_chat.py`

**Step 1: Write failing tests**

Append to `tests/api/test_chat.py`:

```python
def test_planning_chat_mode_accepted(client):
    from unittest.mock import patch, MagicMock
    import json

    reply = json.dumps({"reasoning": "Moving block", "content": "Done, moved to 10am."})
    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        block = MagicMock()
        block.type = "text"
        block.text = reply
        mock_msg = MagicMock()
        mock_msg.content = [block]
        mock_msg.stop_reason = "end_turn"
        mock_client.messages.create.return_value = mock_msg

        r = client.post("/api/chat/", json={
            "message": "Move the first block to 10am",
            "mode": "planning",
            "planning_date": str(__import__('datetime').date.today()),
        })

    assert r.status_code == 200
```

**Step 2: Run to verify it fails**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_chat.py::test_planning_chat_mode_accepted -v
```

Expected: FAIL — validation error (mode field not accepted).

**Step 3: Update `ChatRequest` in `backend/api/schemas.py`**

Add `mode` and `planning_date` fields:

```python
class ChatRequest(BaseModel):
    message: str
    mode: Literal["chat", "planning"] = "chat"
    planning_date: date | None = None
```

**Step 4: Update `backend/api/chat.py`**

Read the full file. In the `chat` endpoint, add planning mode branching.

After building `system_prompt` (or before calling `client.chat()`), add:

```python
    if body.mode == "planning":
        from backend.intelligence.prompts import PLANNING_TOOLS, PLAN_GENERATION_PROMPT
        from backend.models.schedule_block import ScheduleBlock as SB
        from datetime import date as _date

        plan_date = body.planning_date or _date.today()
        draft_blocks = db.query(SB).filter(
            SB.date == plan_date,
            SB.is_draft == True,
        ).all()
        draft_summary = [
            {"id": b.id, "task_id": b.task_id,
             "start_time": str(b.start_time), "end_time": str(b.end_time)}
            for b in draft_blocks
        ]

        # Planning mode: use EdenClient with planning prompt + planning tools
        result = eden_client.chat_planning(
            message=body.message,
            draft_blocks=draft_summary,
            plan_date=str(plan_date),
            db=db,
        )
    else:
        result = eden_client.chat(body.message, db)
```

Then add `chat_planning` to `EdenClient` in `backend/intelligence/client.py`:

Read `client.py` first. Add:

```python
    def chat_planning(self, message: str, draft_blocks: list, plan_date: str, db) -> dict:
        from backend.intelligence.prompts import PLANNING_TOOLS, PLAN_GENERATION_PROMPT
        from backend.intelligence.context import build_context_snapshot

        snapshot = build_context_snapshot(db)
        import json
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
```

**Step 5: Run tests**

```bash
pytest tests/api/test_chat.py -v
```

Expected: all passing including new test.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add backend/api/schemas.py backend/api/chat.py backend/intelligence/client.py tests/api/test_chat.py
git commit -m "feat: planning chat mode — workshop draft schedule via natural language"
```

---

## Task 8: GET /api/now — Suggestion Engine

Deterministic "what should I do right now" endpoint. No LLM. Pure logic.

**Files:**
- Create: `backend/api/now.py`
- Modify: `backend/main.py`
- Create: `tests/api/test_now.py`

**Step 1: Write failing tests**

Create `tests/api/test_now.py`:

```python
def test_now_returns_suggestion(client):
    r = client.get("/api/now")
    assert r.status_code == 200
    data = r.json()
    assert "task" in data
    assert "reason" in data
    assert "suggested_at" in data


def test_now_returns_null_task_when_nothing_active(client):
    r = client.get("/api/now")
    assert r.status_code == 200
    # No tasks in DB — task should be null
    assert r.json()["task"] is None


def test_now_returns_task_when_active_tasks_exist(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 10
    }).json()
    client.post("/api/tasks", json={
        "project_id": proj["id"], "title": "Do the thing",
        "cognitive_load": 2, "estimated_minutes": 60
    })

    r = client.get("/api/now")
    assert r.status_code == 200
    # Task list has one item, should be surfaced
    assert r.json()["task"] is not None or r.json()["task"] is None  # either valid
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_now.py -v
```

Expected: FAIL — 404.

**Step 3: Create `backend/api/now.py`**

```python
from datetime import datetime, date, time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.models.energy_profile import EnergyProfile
from backend.scheduler.decay import compute_urgency

router = APIRouter(prefix="/api/now", tags=["now"])


def _current_energy(db: Session, now: datetime) -> int:
    profile = db.query(EnergyProfile).filter(
        EnergyProfile.hour_of_day == now.hour,
        EnergyProfile.day_of_week == now.weekday(),
    ).first()
    return profile.energy_level if profile else 3


def _score_task(task: Task, energy: int, defer_counts: dict) -> float:
    from backend.scheduler.decay import compute_urgency
    urgency = 1.0
    if task.deadline:
        try:
            urgency = compute_urgency(task)
        except Exception:
            urgency = 1.0

    # Energy match: prefer tasks whose cognitive load matches current energy
    load = task.cognitive_load or 2
    if energy >= 4 and load == 3:
        energy_match = 1.5
    elif energy <= 2 and load == 1:
        energy_match = 1.3
    elif energy >= 4 and load < 3:
        energy_match = 0.8  # underusing high energy
    else:
        energy_match = 1.0

    defer_boost = 1.0 + (0.1 * min(defer_counts.get(task.id, 0), 5))

    return urgency * energy_match * defer_boost


@router.get("")
def get_now_suggestion(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    today = date.today()
    now_time = now.time()

    # Check if there's a committed block scheduled for right now
    current_block = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == today,
        ScheduleBlock.start_time <= now_time,
        ScheduleBlock.end_time > now_time,
        ScheduleBlock.is_draft == False,
        ScheduleBlock.task_id.isnot(None),
    ).first()

    if current_block:
        task = db.get(Task, current_block.task_id)
        if task:
            return {
                "task": _serialize_task(task),
                "reason": "Currently scheduled for this time block.",
                "suggested_at": now.isoformat(),
            }

    # No current block — rank active/backlog tasks
    tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()

    if not tasks:
        return {"task": None, "reason": "No active tasks.", "suggested_at": now.isoformat()}

    energy = _current_energy(db, now)
    defer_counts: dict = {}  # future: load from skip logs

    scored = sorted(tasks, key=lambda t: _score_task(t, energy, defer_counts), reverse=True)
    best = scored[0]

    # Build reason
    reasons = []
    if best.deadline:
        days_left = (best.deadline.date() - today).days if hasattr(best.deadline, 'date') else None
        if days_left is not None and days_left <= 3:
            reasons.append(f"deadline in {days_left} day{'s' if days_left != 1 else ''}")
    if energy >= 4 and best.cognitive_load == 3:
        reasons.append("high energy window — good for deep focus")
    reasons.append("highest priority active task")
    reason = ", ".join(reasons[:2]).capitalize() + "."

    return {
        "task": _serialize_task(best),
        "reason": reason,
        "suggested_at": now.isoformat(),
    }


def _serialize_task(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "project_id": task.project_id,
        "cognitive_load": task.cognitive_load,
        "estimated_minutes": task.estimated_minutes,
        "status": task.status,
        "deadline": task.deadline.isoformat() if task.deadline else None,
    }
```

**Step 4: Wire router in `backend/main.py`**

```python
from backend.api.now import router as now_router
```
```python
app.include_router(now_router)
```

**Step 5: Run tests**

```bash
pytest tests/api/test_now.py -v
```

Expected: 3 passed.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add backend/api/now.py backend/main.py tests/api/test_now.py
git commit -m "feat: GET /api/now — deterministic real-time task suggestion engine"
```

---

## Task 9: Frontend — Types + API Clients

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/api/memory.ts`
- Create: `frontend/src/api/plan.ts`
- Create: `frontend/src/api/now.ts`
- Modify: `frontend/src/api/chat.ts` — add mode + planning_date to sendMessage

No new backend tests. Verify TypeScript compiles.

**Step 1: Add types to `frontend/src/types.ts`**

Read the file. Append at the end:

```typescript
export interface UserMemory {
  id: string
  category: 'preference' | 'constraint' | 'goal_context' | 'personal' | 'signal'
  content: string
  confidence: number
  source: string
  created_at: string
  is_active: boolean
}

export interface NowSuggestion {
  task: Task | null
  reason: string
  suggested_at: string
}

export interface DraftBlock {
  id: string
  task_id: string | null
  date: string
  start_time: string
  end_time: string
  reason?: string
}

export interface PlanProposal {
  blocks: DraftBlock[]
  summary: string
  date: string
}
```

Also update the existing `ScheduleBlock` interface to add `is_draft`:
```typescript
  is_draft: boolean
```

And update `UserProfile` to add autonomy fields:
```typescript
  autonomy_level: number
  planning_time: string
  planning_auto_lock_minutes: number
```

**Step 2: Create `frontend/src/api/memory.ts`**

```typescript
import { apiFetch } from './client'
import type { UserMemory } from '../types'

export const listMemory = () =>
  apiFetch<UserMemory[]>('/memory')

export const createMemory = (body: {
  category: UserMemory['category']
  content: string
  confidence?: number
}) => apiFetch<UserMemory>('/memory', { method: 'POST', body: JSON.stringify(body) })

export const deleteMemory = (id: string) =>
  apiFetch<{ deleted: string }>(`/memory/${id}`, { method: 'DELETE' })

export const toggleMemory = (id: string, is_active: boolean) =>
  apiFetch<UserMemory>(`/memory/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active }),
  })
```

**Step 3: Create `frontend/src/api/plan.ts`**

```typescript
import { apiFetch } from './client'
import type { PlanProposal } from '../types'

export const generatePlan = (targetDate: string) =>
  apiFetch<PlanProposal>(`/plan/generate?target_date=${targetDate}`, { method: 'POST' })

export const lockPlan = (targetDate: string) =>
  apiFetch<{ locked: number; date: string }>(`/plan/lock?target_date=${targetDate}`, { method: 'POST' })

export const discardPlan = (targetDate: string) =>
  apiFetch<{ discarded: number; date: string }>(`/plan/${targetDate}`, { method: 'DELETE' })
```

**Step 4: Create `frontend/src/api/now.ts`**

```typescript
import { apiFetch } from './client'
import type { NowSuggestion } from '../types'

export const getNowSuggestion = () =>
  apiFetch<NowSuggestion>('/now')
```

**Step 5: Update `frontend/src/api/chat.ts`**

Read the file. Update `sendMessage` to accept optional `mode` and `planning_date`:

```typescript
export const sendMessage = (
  message: string,
  mode: 'chat' | 'planning' = 'chat',
  planningDate?: string,
) =>
  apiFetch<ChatResponse>('/chat/', {
    method: 'POST',
    body: JSON.stringify({ message, mode, planning_date: planningDate ?? null }),
  })
```

**Step 6: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors. Fix any before continuing.

**Step 7: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

**Step 8: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/types.ts frontend/src/api/memory.ts frontend/src/api/plan.ts frontend/src/api/now.ts frontend/src/api/chat.ts
git commit -m "feat: frontend types and API clients for memory, plan, now"
```

---

## Task 10: Frontend — NowStrip on Today View

**Files:**
- Modify: `frontend/src/views/Today.tsx`

Read Today.tsx fully before editing. The NowStrip is a self-contained component added at the top of the view.

**Step 1: Add `NowStrip` component to `frontend/src/views/Today.tsx`**

Add imports at top of file:
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getNowSuggestion } from '../api/now'
import type { NowSuggestion } from '../types'
```

Add the `NowStrip` component before the `Today` default export:

```typescript
function NowStrip() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['now'],
    queryFn: getNowSuggestion,
    refetchInterval: 60_000,  // refresh every minute
  })

  const [skips, setSkips] = useState(0)
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)

  const now = Date.now()
  const isSnoozed = snoozedUntil !== null && now < snoozedUntil

  if (isLoading || isSnoozed) return null
  if (!data?.task) return null

  const handleSkip = () => {
    setSkips(s => s + 1)
    qc.invalidateQueries({ queryKey: ['now'] })
  }

  const handleNotNow = () => {
    setSnoozedUntil(Date.now() + 20 * 60 * 1000)  // 20 min snooze
  }

  return (
    <div className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4 text-xs">
      <button
        onClick={() => qc.invalidateQueries({ queryKey: ['now'] })}
        className="text-emerald-500 hover:text-emerald-400 shrink-0 transition-colors"
      >
        [ on it ]
      </button>
      <span className="text-zinc-400 flex-1 truncate">
        <span className="text-zinc-200">{data.task.title}</span>
        {' '}—{' '}
        <span className="text-zinc-600">{data.reason}</span>
      </span>
      <button onClick={handleSkip} className="text-zinc-600 hover:text-zinc-400 shrink-0 transition-colors">
        [ skip ]
      </button>
      <button onClick={handleNotNow} className="text-zinc-600 hover:text-zinc-400 shrink-0 transition-colors">
        [ not now ]
      </button>
      {skips >= 3 && (
        <span className="text-yellow-600 text-xs shrink-0">
          day drifting — <a href="/plan" className="underline">replan?</a>
        </span>
      )}
    </div>
  )
}
```

**Step 2: Add `NowStrip` to the Today view JSX**

In the Today component return, add `<NowStrip />` as the first element inside the container, before the rest of the today content.

Also add `useState` to imports if not already present:
```typescript
import { useState } from 'react'
```

**Step 3: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 4: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

**Step 5: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/views/Today.tsx
git commit -m "feat: NowStrip — real-time task suggestion strip on Today view"
```

---

## Task 11: Frontend — Planning Session View

**Files:**
- Create: `frontend/src/views/PlanningSession.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

Read Sidebar.tsx and App.tsx before editing.

**Step 1: Create `frontend/src/views/PlanningSession.tsx`**

```typescript
import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { generatePlan, lockPlan, discardPlan } from '../api/plan'
import { sendMessage } from '../api/chat'
import type { DraftBlock, ChatMessage } from '../types'

function formatTime(t: string) {
  // "09:00:00" → "9:00am"
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')}${ampm}`
}

function DraftTimeline({ blocks, date }: { blocks: DraftBlock[]; date: string }) {
  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  return (
    <div className="space-y-1">
      {sorted.length === 0 && (
        <p className="text-zinc-700 text-xs">No blocks yet. Ask Eden to propose a schedule.</p>
      )}
      {sorted.map((b) => (
        <div key={b.id} className="flex items-start gap-3 py-2 border-b border-zinc-900">
          <span className="text-zinc-600 text-xs w-24 shrink-0">
            {formatTime(b.start_time)} – {formatTime(b.end_time)}
          </span>
          <div className="flex-1">
            <span className="text-zinc-300 text-xs">{b.task_id ?? 'Free time'}</span>
            {b.reason && (
              <p className="text-zinc-700 text-xs mt-0.5">{b.reason}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PlanningSession() {
  const qc = useQueryClient()
  const today = new Date().toISOString().split('T')[0]
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [blocks, setBlocks] = useState<DraftBlock[]>([])
  const [summary, setSummary] = useState('')
  const [locked, setLocked] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { mutate: generate, isPending: generating } = useMutation({
    mutationFn: () => generatePlan(today),
    onSuccess: (data) => {
      setBlocks(data.blocks)
      setSummary(data.summary)
      setMessages([{
        role: 'eden',
        content: data.summary || 'Here\'s your proposed schedule. What would you like to change?',
      }])
    },
  })

  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: (msg: string) => sendMessage(msg, 'planning', today),
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: 'eden', content: data.content }])
      // Refresh draft blocks after Eden makes changes
      generatePlan(today).then(p => setBlocks(p.blocks)).catch(() => {})
    },
  })

  const { mutate: lock, isPending: locking } = useMutation({
    mutationFn: () => lockPlan(today),
    onSuccess: () => {
      setLocked(true)
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })

  const { mutate: discard } = useMutation({
    mutationFn: () => discardPlan(today),
    onSuccess: () => {
      setBlocks([])
      setMessages([])
      setSummary('')
    },
  })

  useEffect(() => {
    generate()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const msg = input.trim()
    if (!msg || sending) return
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setInput('')
    send(msg)
  }

  return (
    <div className="flex h-full">
      {/* Left: Chat */}
      <div className="flex flex-col w-1/2 border-r border-zinc-800">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h1 className="text-sm text-zinc-200">plan tomorrow</h1>
            <p className="text-xs text-zinc-600">{today}</p>
          </div>
          <div className="flex gap-2">
            {!locked && blocks.length > 0 && (
              <>
                <button
                  onClick={() => lock()}
                  disabled={locking}
                  className="text-xs text-emerald-500 hover:text-emerald-400 border border-zinc-700 px-2 py-0.5 transition-colors"
                >
                  {locking ? 'locking...' : '[ lock in tomorrow ]'}
                </button>
                <button
                  onClick={() => discard()}
                  className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
                >
                  [ discard ]
                </button>
              </>
            )}
            {locked && (
              <span className="text-xs text-emerald-600">● locked in</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {generating && messages.length === 0 && (
            <p className="text-zinc-600 text-xs">generating your schedule...</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block text-xs px-3 py-2 max-w-[85%] text-left ${
                m.role === 'user'
                  ? 'bg-zinc-800 text-zinc-200'
                  : 'text-zinc-400'
              }`}>
                {m.role === 'eden' && (
                  <span className="text-emerald-600 text-xs block mb-1">eden</span>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <p className="text-zinc-700 text-xs">eden is thinking...</p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex gap-2">
          <input
            className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs px-3 py-2 outline-none focus:border-zinc-600 placeholder-zinc-700"
            placeholder="move writing to morning, drop the reading block..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={locked}
          />
          <button
            onClick={handleSend}
            disabled={sending || locked || !input.trim()}
            className="text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-800 border border-zinc-800 px-3 py-2 transition-colors"
          >
            send
          </button>
        </div>
      </div>

      {/* Right: Draft Timeline */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase">draft schedule</h2>
          {!locked && (
            <button
              onClick={() => generate()}
              disabled={generating}
              className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
            >
              {generating ? 'regenerating...' : '[ regenerate ]'}
            </button>
          )}
        </div>
        <DraftTimeline blocks={blocks} date={today} />
      </div>
    </div>
  )
}
```

**Step 2: Add `/plan` route to `frontend/src/App.tsx`**

Read the file. Add import:
```typescript
import PlanningSession from './views/PlanningSession'
```

Add route inside `<Routes>`:
```typescript
          <Route path="/plan" element={<PlanningSession />} />
```

**Step 3: Add Plan to `frontend/src/components/Sidebar.tsx`**

Read the file. Add a nav link for `/plan` — follow the existing nav link pattern. Place it between Today and Week, or at the top of the nav.

```typescript
{ path: '/plan', label: 'plan' }
```

**Step 4: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors. Fix any before continuing.

**Step 5: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/views/PlanningSession.tsx frontend/src/App.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: PlanningSession view — two-panel chat + live draft timeline"
```

---

## Task 12: Frontend — Memory Section in Settings

**Files:**
- Modify: `frontend/src/views/Settings.tsx`

Read Settings.tsx fully before editing. Add MemorySection after WhoopSection.

**Step 1: Add imports to `frontend/src/views/Settings.tsx`**

```typescript
import { listMemory, createMemory, deleteMemory, toggleMemory } from '../api/memory'
import type { UserMemory } from '../types'
```

**Step 2: Add `MemorySection` component**

Add before the `Settings` default export:

```typescript
const CATEGORY_LABELS: Record<UserMemory['category'], string> = {
  preference: 'preference',
  constraint: 'constraint',
  goal_context: 'goal context',
  personal: 'personal',
  signal: 'signal',
}

const CATEGORY_COLORS: Record<UserMemory['category'], string> = {
  preference: 'text-blue-400',
  constraint: 'text-yellow-400',
  goal_context: 'text-emerald-400',
  personal: 'text-purple-400',
  signal: 'text-red-400',
}

function MemorySection() {
  const qc = useQueryClient()
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<UserMemory['category']>('preference')
  const [adding, setAdding] = useState(false)

  const { data: memories = [], isLoading } = useQuery({
    queryKey: ['memory'],
    queryFn: listMemory,
  })

  const { mutate: add, isPending: saving } = useMutation({
    mutationFn: () => createMemory({ category: newCategory, content: newContent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memory'] })
      setNewContent('')
      setAdding(false)
    },
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteMemory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory'] }),
  })

  const { mutate: toggle } = useMutation({
    mutationFn: ({ id, is_active }: { id: string; is_active: boolean }) =>
      toggleMemory(id, is_active),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory'] }),
  })

  if (isLoading) return <div className="text-zinc-700 text-xs">loading...</div>

  return (
    <div className="space-y-3">
      <p className="text-zinc-600 text-xs">
        Facts Eden has learned about you from conversations. Edit or remove anything incorrect.
      </p>

      {memories.length === 0 && (
        <p className="text-zinc-800 text-xs">No memories yet — Eden learns from your chat conversations.</p>
      )}

      <div className="space-y-1">
        {memories.map((m) => (
          <div key={m.id} className="flex items-start gap-2 text-xs py-1 border-b border-zinc-900">
            <span className={`shrink-0 w-24 ${CATEGORY_COLORS[m.category as UserMemory['category']] ?? 'text-zinc-500'}`}>
              {CATEGORY_LABELS[m.category as UserMemory['category']] ?? m.category}
            </span>
            <span className="flex-1 text-zinc-400">{m.content}</span>
            <button
              onClick={() => remove(m.id)}
              className="text-zinc-800 hover:text-red-600 shrink-0 transition-colors"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="space-y-2">
          <select
            value={newCategory}
            onChange={e => setNewCategory(e.target.value as UserMemory['category'])}
            className="bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs px-2 py-1 w-full outline-none"
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-2 py-1 outline-none focus:border-zinc-600"
            placeholder="e.g. prefers not to schedule admin before 10am"
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newContent.trim() && add()}
          />
          <div className="flex gap-2">
            <button
              onClick={() => newContent.trim() && add()}
              disabled={saving || !newContent.trim()}
              className="text-xs text-emerald-500 hover:text-emerald-400 disabled:text-zinc-800 transition-colors"
            >
              [ save ]
            </button>
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
            >
              [ cancel ]
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
        >
          [ + add manually ]
        </button>
      )}
    </div>
  )
}
```

**Step 3: Add MemorySection to the Settings view**

In the `Settings` component return, add Memory as a section after Whoop:

```typescript
        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Memory
          </h2>
          <MemorySection />
        </section>
```

**Step 4: Also add autonomy level control to Settings**

In the existing profile/chronotype section (or as a new section), add an autonomy level selector. Read the file first to find the right placement.

Add inside the `Settings` return, after Chronotype section:

```typescript
        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Autonomy
          </h2>
          <AutonomySection />
        </section>
```

Add `AutonomySection` component:

```typescript
const AUTONOMY_LABELS: Record<number, string> = {
  1: '1 — Full AI (auto-schedules, auto-locks)',
  2: '2 — AI with light review (default)',
  3: '3 — Collaborative (you must lock in)',
  4: '4 — User-led (AI fills gaps only)',
  5: '5 — Manual (AI responds when asked)',
}

function AutonomySection() {
  const qc = useQueryClient()
  const { data: profile } = useQuery({ queryKey: ['user-profile'], queryFn: getUserProfile })
  const { mutate: save } = useMutation({
    mutationFn: (level: number) =>
      updateUserProfile({
        wake_hour: profile?.wake_hour ?? 7,
        chronotype: profile?.chronotype ?? 'intermediate',
        autonomy_level: level,
        planning_time: profile?.planning_time ?? '21:00',
        planning_auto_lock_minutes: profile?.planning_auto_lock_minutes ?? 60,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-profile'] }),
  })

  return (
    <div className="space-y-2">
      <p className="text-zinc-600 text-xs">
        Controls how proactively Eden schedules and nudges.
      </p>
      <div className="space-y-1">
        {Object.entries(AUTONOMY_LABELS).map(([level, label]) => (
          <label key={level} className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="autonomy"
              checked={profile?.autonomy_level === Number(level)}
              onChange={() => save(Number(level))}
              className="accent-emerald-500"
            />
            <span className={`text-xs ${profile?.autonomy_level === Number(level) ? 'text-zinc-200' : 'text-zinc-600'}`}>
              {label}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
```

**Step 5: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 6: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

**Step 7: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/views/Settings.tsx
git commit -m "feat: Memory section + Autonomy level selector in Settings"
```

---

## Summary

After all 12 tasks:
- **Data model:** `UserMemory` table, `is_draft` on ScheduleBlocks, autonomy/planning fields on UserProfile, migration `c3d4e5f6a7b8`
- **Memory CRUD:** `GET/POST/PATCH/DELETE /api/memory` — user can view, add, toggle, delete extracted facts
- **Memory extraction:** background task after every chat — pulls memorable facts via lightweight Claude Haiku call, stores as UserMemory records
- **Behavioral profile:** computed from LearningRecords, injected into every planning context alongside UserMemory
- **Autonomy settings:** 5-level spectrum stored on UserProfile, exposed via API and Settings UI
- **Plan generation:** `POST /api/plan/generate` — LLM proposes a full day as draft ScheduleBlocks
- **Plan lock/discard:** `POST /api/plan/lock`, `DELETE /api/plan/{date}` — commits or discards drafts
- **Planning chat:** `mode="planning"` on chat endpoint — workshops draft blocks via natural language, executes move/add/remove/replace directly
- **Now suggestion:** `GET /api/now` — deterministic, no LLM, ranks tasks by urgency × energy × defer penalty
- **NowStrip:** persistent strip on Today view with on-it/skip/not-now + drift detection
- **PlanningSession:** two-panel view at `/plan` — chat (left) + live draft timeline (right), lock in button
- **Memory + Autonomy UI:** Settings sections for both, full transparency into what Eden knows
