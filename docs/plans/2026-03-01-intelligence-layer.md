# Intelligence Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the LLM reasoning layer — a context snapshot builder that serializes all Eden state, a system prompt module, and a Claude API client that always injects full context and returns structured responses with a `reasoning` field.

**Architecture:** Three modules: `context.py` queries the DB and produces a single JSON-serializable snapshot (goals, projects, tasks by category, schedule, energy, learning summary, proactive alerts); `prompts.py` owns all prompt strings; `client.py` wraps the Anthropic SDK, always builds the full snapshot before calling, and never hardcodes prompts. Tests mock the Anthropic API — no live calls ever.

**Tech Stack:** Python, anthropic SDK, SQLAlchemy (for DB queries in context builder), pytest, unittest.mock

---

## Task 1: Add anthropic dependency + test scaffold

**Files:**
- Modify: `pyproject.toml`
- Create: `tests/intelligence/__init__.py`

**Step 1: Add anthropic to pyproject.toml**

Read `pyproject.toml` and add `"anthropic>=0.40.0",` to the `dependencies` list.

**Step 2: Sync**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv sync --extra dev
```

Verify:
```bash
uv run python -c "import anthropic; print('ok')"
```

Expected: `ok`

**Step 3: Create test directory**

```bash
touch /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/tests/intelligence/__init__.py
```

**Step 4: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add pyproject.toml uv.lock tests/intelligence/__init__.py
git commit -m "feat: add anthropic dependency and intelligence test directory"
```

---

## Task 2: backend/intelligence/context.py

**Files:**
- Create: `backend/intelligence/context.py`
- Create: `tests/intelligence/test_context.py`

The context builder queries the live DB and returns a fully serializable dict. It also generates rule-based proactive alerts (no LLM call). Urgency scores are computed via `decay.py`.

**Step 1: Write failing tests**

```python
# tests/intelligence/test_context.py
import uuid
from datetime import date, datetime, timedelta, time
from backend.intelligence.context import build_context_snapshot
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord


def _make_goal(db):
    g = Goal(
        id=str(uuid.uuid4()), title="Test Goal", tier="long",
        weight=0.9, target_date=date(2027, 1, 1), status="active",
    )
    db.add(g)
    db.commit()
    return g


def _make_project(db, goal):
    p = Project(
        id=str(uuid.uuid4()), title="Test Project", category="engineering",
        goal_id=goal.id, status="active",
    )
    db.add(p)
    db.commit()
    return p


def _make_task(db, project, status="backlog", deadline=None):
    t = Task(
        id=str(uuid.uuid4()), title="Test Task", project_id=project.id,
        cognitive_load=2, estimated_minutes=60,
        status=status, source="manual",
        deadline=deadline,
    )
    db.add(t)
    db.commit()
    return t


# --- Snapshot structure ---

def test_snapshot_has_all_top_level_keys(db):
    snap = build_context_snapshot(db)
    for key in ("goals", "projects", "tasks", "schedule", "energy_profile", "learning_summary", "alerts"):
        assert key in snap, f"Missing key: {key}"


def test_snapshot_tasks_has_all_categories(db):
    snap = build_context_snapshot(db)
    for cat in ("due_soon", "active", "backlog", "deferred"):
        assert cat in snap["tasks"], f"Missing task category: {cat}"


def test_snapshot_schedule_has_today_and_week(db):
    snap = build_context_snapshot(db)
    assert "today" in snap["schedule"]
    assert "week" in snap["schedule"]


# --- Goals ---

def test_active_goals_included(db):
    goal = _make_goal(db)
    snap = build_context_snapshot(db)
    ids = [g["id"] for g in snap["goals"]]
    assert goal.id in ids


def test_done_goals_excluded(db):
    goal = Goal(
        id=str(uuid.uuid4()), title="Done Goal", tier="long",
        weight=0.5, target_date=date(2025, 1, 1), status="done",
    )
    db.add(goal)
    db.commit()
    snap = build_context_snapshot(db)
    ids = [g["id"] for g in snap["goals"]]
    assert goal.id not in ids


def test_goal_serialization_fields(db):
    goal = _make_goal(db)
    snap = build_context_snapshot(db)
    g = next(g for g in snap["goals"] if g["id"] == goal.id)
    for field in ("id", "title", "tier", "weight", "target_date", "status"):
        assert field in g


# --- Tasks ---

def test_in_progress_task_goes_to_active(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="in_progress")
    snap = build_context_snapshot(db)
    active_ids = [t["id"] for t in snap["tasks"]["active"]]
    assert task.id in active_ids


def test_deferred_task_goes_to_deferred(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="deferred")
    snap = build_context_snapshot(db)
    deferred_ids = [t["id"] for t in snap["tasks"]["deferred"]]
    assert task.id in deferred_ids


def test_task_due_soon_within_72h(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now + timedelta(hours=48)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    due_soon_ids = [t["id"] for t in snap["tasks"]["due_soon"]]
    assert task.id in due_soon_ids


def test_task_serialization_includes_urgency(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now + timedelta(days=5)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    backlog_task = next(t for t in snap["tasks"]["backlog"] if t["id"] == task.id)
    assert "urgency_score" in backlog_task
    assert backlog_task["urgency_score"] > 0


# --- Learning summary ---

def test_learning_summary_with_no_records(db):
    snap = build_context_snapshot(db)
    ls = snap["learning_summary"]
    assert ls["total_records"] == 0
    assert ls["avg_duration_ratio"] == 1.0


def test_learning_summary_with_records(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="done")
    # Task took 1.5x as long as estimated
    record = LearningRecord(
        id=str(uuid.uuid4()), task_id=task.id,
        estimated_minutes=60, actual_minutes=90,
        energy_level_at_start=3, completion_quality=4,
    )
    db.add(record)
    db.commit()
    snap = build_context_snapshot(db)
    ls = snap["learning_summary"]
    assert ls["total_records"] == 1
    assert abs(ls["avg_duration_ratio"] - 1.5) < 1e-6


# --- Alerts ---

def test_alert_generated_for_task_past_deadline(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now - timedelta(hours=2)  # past deadline
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    alert_tasks = [a["task_id"] for a in snap["alerts"] if a.get("task_id")]
    assert task.id in alert_tasks


def test_alert_generated_for_task_due_within_24h(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now + timedelta(hours=12)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    alert_tasks = [a["task_id"] for a in snap["alerts"] if a.get("task_id")]
    assert task.id in alert_tasks
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/intelligence/test_context.py -v
```

Expected: FAIL — module not found.

**Step 3: Write `backend/intelligence/context.py`**

```python
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord
from backend.scheduler.decay import compute_urgency

_72H = timedelta(hours=72)
_24H = timedelta(hours=24)


def build_context_snapshot(db: Session, now: datetime | None = None) -> dict:
    """
    Build the full context snapshot passed to the LLM on every call.
    Never call the LLM without this snapshot.
    """
    if now is None:
        now = datetime.utcnow()

    goals = _build_goals(db)
    projects = _build_projects(db)
    tasks = _build_tasks(db, now)
    schedule = _build_schedule(db, now)
    energy_profile = _build_energy_profile(db, now)
    learning_summary = _build_learning_summary(db)
    alerts = _build_alerts(db, now)

    return {
        "goals": goals,
        "projects": projects,
        "tasks": tasks,
        "schedule": schedule,
        "energy_profile": energy_profile,
        "learning_summary": learning_summary,
        "alerts": alerts,
    }


# --- Internal builders ---

def _build_goals(db: Session) -> list[dict]:
    goals = db.query(Goal).filter(Goal.status.in_(["active", "paused"])).all()
    return [_serialize_goal(g) for g in goals]


def _build_projects(db: Session) -> list[dict]:
    projects = db.query(Project).filter(Project.status.in_(["active", "paused"])).all()
    return [_serialize_project(p) for p in projects]


def _build_tasks(db: Session, now: datetime) -> dict:
    cutoff_72h = now + _72H
    all_tasks = db.query(Task).filter(
        Task.status.notin_(["done", "dropped"])
    ).all()

    due_soon = []
    active = []
    backlog = []
    deferred = []

    for task in all_tasks:
        serialized = _serialize_task(task, now)
        if task.status == "deferred":
            deferred.append(serialized)
        elif task.status == "in_progress":
            active.append(serialized)
        elif task.deadline and task.deadline <= cutoff_72h:
            due_soon.append(serialized)
        else:
            backlog.append(serialized)

    # Sort backlog by urgency descending
    backlog.sort(key=lambda t: t["urgency_score"], reverse=True)
    due_soon.sort(key=lambda t: t.get("deadline") or "", reverse=False)

    return {
        "due_soon": due_soon,
        "active": active,
        "backlog": backlog,
        "deferred": deferred,
    }


def _build_schedule(db: Session, now: datetime) -> dict:
    today = now.date()
    week_start = today
    week_end = today + timedelta(days=7)

    all_blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= week_start,
        ScheduleBlock.date < week_end,
    ).all()

    today_blocks = [_serialize_block(b) for b in all_blocks if b.date == today]
    week_blocks = [_serialize_block(b) for b in all_blocks]

    return {"today": today_blocks, "week": week_blocks}


def _build_energy_profile(db: Session, now: datetime) -> dict:
    dow = now.weekday()  # 0 = Monday
    profiles = db.query(EnergyProfile).filter(EnergyProfile.day_of_week == dow).all()
    hourly = {}
    for p in profiles:
        hourly[str(p.hour_of_day)] = {
            "energy_level": p.energy_level,
            "is_post_hard_workout": p.is_post_hard_workout,
            "notes": p.notes,
        }
    return {"today_day_of_week": dow, "hourly": hourly}


def _build_learning_summary(db: Session) -> dict:
    records = db.query(LearningRecord).all()
    if not records:
        return {
            "total_records": 0,
            "avg_duration_ratio": 1.0,
            "overestimate_rate": 0.0,
            "underestimate_rate": 0.0,
        }

    ratios = [r.actual_minutes / r.estimated_minutes for r in records]
    avg_ratio = sum(ratios) / len(ratios)
    over = sum(1 for r in ratios if r < 1.0) / len(ratios)
    under = sum(1 for r in ratios if r > 1.0) / len(ratios)

    return {
        "total_records": len(records),
        "avg_duration_ratio": avg_ratio,
        "overestimate_rate": over,
        "underestimate_rate": under,
    }


def _build_alerts(db: Session, now: datetime) -> list[dict]:
    alerts = []
    cutoff_24h = now + _24H

    tasks_with_deadlines = db.query(Task).filter(
        Task.deadline.isnot(None),
        Task.status.notin_(["done", "dropped"]),
    ).all()

    for task in tasks_with_deadlines:
        if task.deadline <= now:
            alerts.append({
                "type": "past_deadline",
                "severity": "critical",
                "task_id": task.id,
                "message": f"'{task.title}' is past its deadline.",
            })
        elif task.deadline <= cutoff_24h:
            hours_left = int((task.deadline - now).total_seconds() / 3600)
            alerts.append({
                "type": "due_soon",
                "severity": "high",
                "task_id": task.id,
                "message": f"'{task.title}' is due in {hours_left}h.",
            })

    return alerts


# --- Serializers ---

def _serialize_goal(goal: Goal) -> dict:
    return {
        "id": goal.id,
        "title": goal.title,
        "tier": goal.tier,
        "weight": goal.weight,
        "target_date": str(goal.target_date),
        "status": goal.status,
        "parent_id": goal.parent_id,
    }


def _serialize_project(project: Project) -> dict:
    return {
        "id": project.id,
        "title": project.title,
        "category": project.category,
        "goal_id": project.goal_id,
        "priority_score": project.priority_score,
        "status": project.status,
        "estimated_hours_remaining": project.estimated_hours_remaining,
        "github_repo": project.github_repo,
    }


def _serialize_task(task: Task, now: datetime) -> dict:
    urgency = compute_urgency(
        base_priority=1.0,
        deadline=task.deadline,
        created_at=task.created_at,
        now=now,
    )
    return {
        "id": task.id,
        "title": task.title,
        "project_id": task.project_id,
        "status": task.status,
        "cognitive_load": task.cognitive_load,
        "estimated_minutes": task.estimated_minutes,
        "actual_minutes": task.actual_minutes,
        "deadline": str(task.deadline) if task.deadline else None,
        "urgency_score": round(urgency, 4),
        "dependency_ids": [d.id for d in task.dependencies],
        "source": task.source,
    }


def _serialize_block(block: ScheduleBlock) -> dict:
    return {
        "id": block.id,
        "task_id": block.task_id,
        "date": str(block.date),
        "start_time": str(block.start_time),
        "end_time": str(block.end_time),
        "auto_generated": block.auto_generated,
        "overridden_by_user": block.overridden_by_user,
    }
```

**Step 4: Run to verify they pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/intelligence/test_context.py -v
```

Expected: all tests PASS.

**Step 5: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/intelligence/context.py tests/intelligence/test_context.py
git commit -m "feat: add context snapshot builder with alerts and urgency scoring"
```

---

## Task 3: backend/intelligence/prompts.py

**Files:**
- Create: `backend/intelligence/prompts.py`
- Create: `tests/intelligence/test_prompts.py`

**Step 1: Write failing tests**

```python
# tests/intelligence/test_prompts.py
from backend.intelligence.prompts import SYSTEM_PROMPT, format_chat_prompt


def test_system_prompt_is_nonempty():
    assert len(SYSTEM_PROMPT) > 100


def test_system_prompt_establishes_eden_role():
    assert "Eden" in SYSTEM_PROMPT
    assert "reasoning" in SYSTEM_PROMPT.lower()


def test_system_prompt_requires_json_response():
    assert "JSON" in SYSTEM_PROMPT


def test_system_prompt_not_general_assistant():
    # Must explicitly call out that this is not a general assistant
    assert "general assistant" in SYSTEM_PROMPT.lower() or "general-purpose" in SYSTEM_PROMPT.lower()


def test_format_chat_prompt_includes_context():
    snapshot = {"goals": [], "projects": [], "tasks": {}, "alerts": []}
    result = format_chat_prompt("What should I do?", snapshot)
    assert "<context>" in result
    assert "What should I do?" in result


def test_format_chat_prompt_includes_serialized_snapshot():
    snapshot = {"goals": [{"id": "abc"}], "projects": []}
    result = format_chat_prompt("test", snapshot)
    assert "abc" in result
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/intelligence/test_prompts.py -v
```

Expected: FAIL.

**Step 3: Write `backend/intelligence/prompts.py`**

```python
import json

SYSTEM_PROMPT = """You are Eden's reasoning engine.

Eden is a personal AI operating system for a single high-output individual managing research, engineering, athletics, academic work, and career development simultaneously. You are not a general assistant. You are a focused reasoning system with full visibility into this person's goals, tasks, schedule, and energy.

Your job is to reason about the user's state and give specific, actionable, explainable responses.

Rules:
1. Always respond with valid JSON in this exact format:
   {"reasoning": "...", "content": "..."}

2. The "reasoning" field must explain your response by referencing specific data from the context — goal weights, urgency scores, deadline proximity, energy levels, cognitive load. Never speak in generalities.

3. The "content" field is your response to the user.

4. When explaining a scheduling decision, cite the actual numbers. Example: "Task X has urgency 3.21 and cognitive_load 3 — it should land in a high-energy slot (energy ≥ 4). Your 9am block on Tuesday has energy 5."

5. Be direct. Do not hedge. The user acts on what you say.
"""


def format_chat_prompt(user_message: str, context_snapshot: dict) -> str:
    """
    Wraps the user's message with the full context snapshot.
    Every LLM call must use this — never pass raw user messages without context.
    """
    context_str = json.dumps(context_snapshot, indent=2, default=str)
    return f"<context>\n{context_str}\n</context>\n\n{user_message}"
```

**Step 4: Run to verify they pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/intelligence/test_prompts.py -v
```

Expected: PASS.

**Step 5: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/intelligence/prompts.py tests/intelligence/test_prompts.py
git commit -m "feat: add system prompt and chat prompt formatter"
```

---

## Task 4: backend/intelligence/client.py

**Files:**
- Create: `backend/intelligence/client.py`
- Create: `tests/intelligence/test_client.py`

The client wraps the Anthropic SDK. Tests mock the SDK — never make live API calls.

**Step 1: Write failing tests**

```python
# tests/intelligence/test_client.py
import uuid
import json
from datetime import date, datetime
from unittest.mock import MagicMock, patch
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task


def _setup_db(db):
    """Populate DB with minimal data so context snapshot has something."""
    goal = Goal(
        id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
        target_date=date(2027, 1, 1), status="active",
    )
    project = Project(
        id=str(uuid.uuid4()), title="P", category="engineering",
        goal_id=goal.id, status="active",
    )
    task = Task(
        id=str(uuid.uuid4()), title="T", project_id=project.id,
        cognitive_load=2, estimated_minutes=60, status="backlog", source="manual",
    )
    db.add_all([goal, project, task])
    db.commit()


def _mock_response(text: str):
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    return msg


def test_chat_calls_anthropic_api(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "Because X", "content": "Do task T."})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        result = client.chat("What should I do?", db)

        assert mock_client.messages.create.called


def test_chat_injects_full_context(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "r", "content": "c"})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        client.chat("test", db)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        user_content = call_kwargs["messages"][0]["content"]
        assert "<context>" in user_content
        assert "goals" in user_content


def test_chat_uses_system_prompt(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "r", "content": "c"})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        client.chat("test", db)

        call_kwargs = mock_client.messages.create.call_args.kwargs
        assert "system" in call_kwargs
        assert "Eden" in call_kwargs["system"]


def test_chat_returns_parsed_response(db):
    _setup_db(db)
    reply = json.dumps({"reasoning": "Task X is urgent.", "content": "Work on X now."})

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response(reply)

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        result = client.chat("What next?", db)

        assert result["reasoning"] == "Task X is urgent."
        assert result["content"] == "Work on X now."


def test_chat_handles_non_json_response(db):
    _setup_db(db)

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_response("plain text response")

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        result = client.chat("test", db)

        assert "content" in result
        assert result["content"] == "plain text response"
        assert "reasoning" in result


def test_get_alerts_does_not_call_llm(db):
    _setup_db(db)

    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client

        from backend.intelligence.client import EdenClient
        client = EdenClient()
        alerts = client.get_alerts(db)

        assert isinstance(alerts, list)
        assert not mock_client.messages.create.called  # No LLM call
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/intelligence/test_client.py -v
```

Expected: FAIL.

**Step 3: Write `backend/intelligence/client.py`**

```python
import json
import anthropic
from sqlalchemy.orm import Session

from backend.config import settings
from backend.intelligence.context import build_context_snapshot
from backend.intelligence.prompts import SYSTEM_PROMPT, format_chat_prompt


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
        Send a user message to the LLM with full context injected.
        Returns a dict with 'reasoning' and 'content' keys.
        """
        snapshot = build_context_snapshot(db, now=now)
        prompt = format_chat_prompt(user_message, snapshot)

        response = self._client.messages.create(
            model=settings.llm_model,
            max_tokens=2048,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )

        raw = response.content[0].text
        try:
            parsed = json.loads(raw)
            if "reasoning" not in parsed:
                parsed["reasoning"] = ""
            return parsed
        except json.JSONDecodeError:
            return {"content": raw, "reasoning": ""}

    def get_alerts(self, db: Session, now=None) -> list[dict]:
        """
        Return proactive alerts from the context snapshot.
        Does NOT call the LLM — alerts are rule-based from the context builder.
        """
        snapshot = build_context_snapshot(db, now=now)
        return snapshot.get("alerts", [])
```

**Step 4: Run to verify they pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/intelligence/test_client.py -v
```

Expected: PASS.

**Step 5: Run full test suite**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/ -v
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/intelligence/client.py tests/intelligence/test_client.py
git commit -m "feat: add Claude API client with full context injection and structured response parsing"
```

---

## Done

At this point you have:
- `backend/intelligence/context.py` — full context snapshot builder (goals, projects, tasks by category with urgency scores, schedule, energy profile, learning summary, proactive alerts)
- `backend/intelligence/prompts.py` — system prompt establishing Eden as reasoning engine; `format_chat_prompt` wrapping every user message with context
- `backend/intelligence/client.py` — Anthropic SDK wrapper that always builds the snapshot, always uses the system prompt, always returns `{reasoning, content}`

Next layer: FastAPI routes (`backend/api/`) to wire the scheduler and intelligence layer to HTTP endpoints.
