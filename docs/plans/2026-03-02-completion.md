# Completion Plan: Recurring Tasks, Dependencies UI, Whoop Integration

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Close the remaining functional gaps before Whoop/calendar work — fix recurring task deadlines, add task dependency editing, then build Whoop integration (OAuth, daily sync, recovery-driven scheduling, Settings UI).

**Architecture:** Three independent feature areas. Recurring tasks is a one-file backend fix. Dependencies adds a field to TaskUpdate/TaskResponse and a picker UI to Projects.tsx. Whoop adds two new models, an OAuth flow, a sync job, a recovery multiplier in the scheduler engine, and a Settings section. Each is independently committable.

**Tech Stack:** FastAPI, SQLAlchemy, Pydantic v2, OR-Tools CP-SAT, React + TanStack Query, Whoop Developer API (OAuth 2.0 + REST), httpx.

---

## Background: Key Files

Read these before implementing any task:
- `backend/api/tasks.py` — complete_task and update_task endpoints
- `backend/api/schemas.py` — TaskUpdate, TaskResponse (add dependency_ids to both)
- `backend/models/task.py` — Task ORM model, task_dependencies association table
- `backend/scheduler/engine.py` — SchedulerEngine.run() — add recovery_multiplier param
- `backend/api/schedule.py` — _run_scheduler_job() — passes args to engine
- `backend/intelligence/context.py` — build_context_snapshot() — add whoop_today
- `frontend/src/views/Projects.tsx` — TaskRow, ProjectCard — add dependency picker
- `frontend/src/views/Settings.tsx` — add Whoop section
- `alembic/versions/a1b2c3d4e5f6_add_user_profile.py` — migration pattern to copy
- `backend/config.py` — add WHOOP_* env vars

---

## Task 1: Fix Recurring Task Deadline Propagation

**Problem:** When a recurring task is completed, tasks.py already creates a copy — but the copy has no deadline. If the original had a deadline (e.g., weekly review due Friday), the next occurrence should be due next Friday.

**Files:**
- Modify: `backend/api/tasks.py`
- Modify: `tests/api/test_tasks.py`

**Step 1: Write failing tests**

In `tests/api/test_tasks.py`, add after the existing tests:

```python
import uuid
from datetime import datetime, timedelta

def _make_project_and_task(client, recurrence_rule="weekly", with_deadline=True):
    goal_r = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0,
        "target_date": "2027-01-01"
    })
    proj_r = client.post("/api/projects", json={
        "title": "P", "goal_id": goal_r.json()["id"],
        "category": "engineering", "estimated_hours_remaining": 10
    })
    deadline = (datetime.utcnow() + timedelta(days=7)).isoformat() if with_deadline else None
    task_r = client.post("/api/tasks", json={
        "project_id": proj_r.json()["id"],
        "title": "Weekly review",
        "cognitive_load": 1,
        "estimated_minutes": 30,
        "recurrence_rule": recurrence_rule,
        "deadline": deadline,
    })
    return task_r.json()


def test_completing_recurring_task_spawns_next_occurrence(client):
    task = _make_project_and_task(client, recurrence_rule="weekly")
    r = client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 25,
        "completion_quality": 4,
        "energy_level_at_start": 3,
    })
    assert r.status_code == 200

    tasks_r = client.get("/api/tasks")
    titles = [t["title"] for t in tasks_r.json()]
    assert titles.count("Weekly review") == 2  # original (done) + new occurrence


def test_recurring_task_next_deadline_is_offset_from_original(client):
    task = _make_project_and_task(client, recurrence_rule="weekly", with_deadline=True)
    original_deadline = task["deadline"]

    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 25, "completion_quality": 4, "energy_level_at_start": 3,
    })

    tasks_r = client.get("/api/tasks")
    new_task = next(t for t in tasks_r.json() if t["id"] != task["id"])
    assert new_task["deadline"] is not None

    orig_dt = datetime.fromisoformat(original_deadline.replace("Z", ""))
    new_dt = datetime.fromisoformat(new_task["deadline"].replace("Z", ""))
    diff = (new_dt - orig_dt).days
    assert diff == 7  # weekly = +7 days


def test_recurring_daily_adds_one_day(client):
    task = _make_project_and_task(client, recurrence_rule="daily", with_deadline=True)
    original_deadline = task["deadline"]

    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 10, "completion_quality": 4, "energy_level_at_start": 3,
    })

    tasks_r = client.get("/api/tasks")
    new_task = next(t for t in tasks_r.json() if t["id"] != task["id"])
    orig_dt = datetime.fromisoformat(original_deadline.replace("Z", ""))
    new_dt = datetime.fromisoformat(new_task["deadline"].replace("Z", ""))
    assert (new_dt - orig_dt).days == 1


def test_recurring_without_deadline_uses_today_as_base(client):
    task = _make_project_and_task(client, recurrence_rule="weekly", with_deadline=False)

    client.post(f"/api/tasks/{task['id']}/complete", json={
        "actual_minutes": 25, "completion_quality": 4, "energy_level_at_start": 3,
    })

    tasks_r = client.get("/api/tasks")
    new_task = next(t for t in tasks_r.json() if t["id"] != task["id"])
    assert new_task["deadline"] is not None
    new_dt = datetime.fromisoformat(new_task["deadline"].replace("Z", ""))
    now = datetime.utcnow()
    # Should be ~7 days from now (allow 1 day slack for test timing)
    assert 6 <= (new_dt - now).days <= 8
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_tasks.py::test_completing_recurring_task_spawns_next_occurrence tests/api/test_tasks.py::test_recurring_task_next_deadline_is_offset_from_original -v
```

Expected: FAIL — new task created but deadline is None.

**Step 3: Fix `complete_task` in `backend/api/tasks.py`**

Add this constant near the top of the file, after the imports:

```python
from datetime import timedelta

_RECURRENCE_INTERVALS: dict[str, timedelta] = {
    "daily":    timedelta(days=1),
    "weekly":   timedelta(days=7),
    "biweekly": timedelta(days=14),
    "monthly":  timedelta(days=30),
}
```

Replace the existing recurrence block (lines 97–110) with:

```python
    if task.recurrence_rule:
        interval = _RECURRENCE_INTERVALS.get(task.recurrence_rule)
        next_deadline: datetime | None = None
        if interval:
            base = task.deadline if task.deadline else datetime.utcnow()
            next_deadline = base + interval
        recurrence_copy = Task(
            id=str(uuid.uuid4()),
            project_id=task.project_id,
            title=task.title,
            description=task.description,
            cognitive_load=task.cognitive_load,
            estimated_minutes=task.estimated_minutes,
            recurrence_rule=task.recurrence_rule,
            deadline=next_deadline,
            source=task.source,
            status="backlog",
            created_at=datetime.utcnow(),
        )
        db.add(recurrence_copy)
```

**Step 4: Run all four tests**

```bash
pytest tests/api/test_tasks.py::test_completing_recurring_task_spawns_next_occurrence tests/api/test_tasks.py::test_recurring_task_next_deadline_is_offset_from_original tests/api/test_tasks.py::test_recurring_daily_adds_one_day tests/api/test_tasks.py::test_recurring_without_deadline_uses_today_as_base -v
```

Expected: 4 passed.

**Step 5: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 6: Commit**

```bash
git add backend/api/tasks.py tests/api/test_tasks.py
git commit -m "fix: recurring task spawns next occurrence with correct deadline offset"
```

---

## Task 2: Task Dependencies — Backend

**Problem:** `TaskUpdate` has no `dependency_ids` field, so there's no API to set them. `TaskResponse` doesn't return them either, so the frontend can't display existing dependencies.

**Files:**
- Modify: `backend/api/schemas.py`
- Modify: `backend/api/tasks.py`
- Modify: `tests/api/test_tasks.py`

**Step 1: Write failing tests**

Append to `tests/api/test_tasks.py`:

```python
def _create_two_tasks(client):
    goal_r = client.post("/api/goals", json={
        "title": "G2", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    })
    proj_r = client.post("/api/projects", json={
        "title": "P2", "goal_id": goal_r.json()["id"],
        "category": "engineering", "estimated_hours_remaining": 10
    })
    pid = proj_r.json()["id"]
    t1 = client.post("/api/tasks", json={
        "project_id": pid, "title": "First", "cognitive_load": 2, "estimated_minutes": 60
    }).json()
    t2 = client.post("/api/tasks", json={
        "project_id": pid, "title": "Second", "cognitive_load": 2, "estimated_minutes": 60
    }).json()
    return t1, t2


def test_task_response_includes_dependency_ids(client):
    t1, t2 = _create_two_tasks(client)
    r = client.get(f"/api/tasks/{t1['id']}")
    assert r.status_code == 200
    assert "dependency_ids" in r.json()
    assert r.json()["dependency_ids"] == []


def test_update_task_sets_dependencies(client):
    t1, t2 = _create_two_tasks(client)
    # t2 depends on t1
    r = client.patch(f"/api/tasks/{t2['id']}", json={"dependency_ids": [t1["id"]]})
    assert r.status_code == 200
    assert t1["id"] in r.json()["dependency_ids"]


def test_update_task_clears_dependencies(client):
    t1, t2 = _create_two_tasks(client)
    client.patch(f"/api/tasks/{t2['id']}", json={"dependency_ids": [t1["id"]]})
    r = client.patch(f"/api/tasks/{t2['id']}", json={"dependency_ids": []})
    assert r.status_code == 200
    assert r.json()["dependency_ids"] == []
```

**Step 2: Run to verify they fail**

```bash
pytest tests/api/test_tasks.py::test_task_response_includes_dependency_ids tests/api/test_tasks.py::test_update_task_sets_dependencies -v
```

Expected: FAIL — `dependency_ids` not in response.

**Step 3: Update `TaskResponse` in `backend/api/schemas.py`**

Add `model_validator` to the existing imports at the top:

```python
from pydantic import BaseModel, field_validator, model_validator
```

Replace the existing `TaskResponse` class with:

```python
class TaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    project_id: str
    title: str
    description: str | None
    status: str
    cognitive_load: int
    estimated_minutes: int
    actual_minutes: int | None
    deadline: datetime | None
    recurrence_rule: str | None
    source: str
    created_at: datetime
    dependency_ids: list[str] = []

    @model_validator(mode='before')
    @classmethod
    def extract_dependency_ids(cls, data):
        # When given an ORM object, convert to dict and pull dependency_ids
        # from the relationship before Pydantic processes it.
        if hasattr(data, '__table__'):
            result = {col.name: getattr(data, col.name) for col in data.__table__.columns}
            result['dependency_ids'] = [d.id for d in getattr(data, 'dependencies', [])]
            return result
        return data
```

**Step 4: Update `TaskUpdate` in `backend/api/schemas.py`**

Add `dependency_ids` field:

```python
class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cognitive_load: int | None = None
    estimated_minutes: int | None = None
    deadline: datetime | None = None
    status: Literal["backlog", "active", "in_progress", "done", "deferred"] | None = None
    recurrence_rule: str | None = None
    dependency_ids: list[str] | None = None
```

**Step 5: Update `update_task` in `backend/api/tasks.py`**

Replace the existing `update_task` endpoint:

```python
@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    data = body.model_dump(exclude_none=True)
    dependency_ids = data.pop('dependency_ids', None)

    for field, value in data.items():
        setattr(task, field, value)

    if dependency_ids is not None:
        deps = db.query(Task).filter(Task.id.in_(dependency_ids)).all() if dependency_ids else []
        task.dependencies = deps

    db.commit()
    db.refresh(task)
    return task
```

**Step 6: Run tests**

```bash
pytest tests/api/test_tasks.py::test_task_response_includes_dependency_ids tests/api/test_tasks.py::test_update_task_sets_dependencies tests/api/test_tasks.py::test_update_task_clears_dependencies -v
```

Expected: 3 passed.

**Step 7: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 8: Commit**

```bash
git add backend/api/schemas.py backend/api/tasks.py tests/api/test_tasks.py
git commit -m "feat: task dependencies — expose in API response and allow update via PATCH"
```

---

## Task 3: Task Dependencies — Frontend UI

**Files:**
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/tasks.ts`
- Modify: `frontend/src/views/Projects.tsx`

No new tests needed (pure UI layer over the API tested in Task 2).

**Step 1: Add `dependency_ids` to `Task` in `frontend/src/types.ts`**

In the `Task` interface, add after `recurrence_rule`:

```typescript
  dependency_ids: string[]
```

**Step 2: Add `dependency_ids` to `updateTask` in `frontend/src/api/tasks.ts`**

Read the file first, then in the `updateTask` body type, add:

```typescript
dependency_ids?: string[]
```

**Step 3: Update `TaskRow` in `frontend/src/views/Projects.tsx`**

Read the file first. Make these changes:

**a) Add `projectTasks` prop to `TaskRow`:**

Change the function signature from:
```typescript
function TaskRow({ task }: { task: Task }) {
```
to:
```typescript
function TaskRow({ task, projectTasks }: { task: Task; projectTasks: Task[] }) {
```

**b) Add dependency state to `TaskRow`:**

After the existing `useState` declarations at the top of TaskRow:
```typescript
  const [editDeps, setEditDeps] = useState<string[]>(task.dependency_ids ?? [])
```

**c) Reset editDeps in `openEdit`:**

In the `openEdit` function, add:
```typescript
    setEditDeps(task.dependency_ids ?? [])
```

**d) Include `dependency_ids` in the save mutation:**

Change the `save` mutation's `mutationFn`:
```typescript
  const { mutate: save } = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        title: editTitle,
        description: editDesc || null,
        estimated_minutes: Number(editMins),
        dependency_ids: editDeps,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setEditing(false)
    },
  })
```

**e) Add the dependency picker to the edit panel:**

In the `editing` JSX block, after the `<textarea>` for description and before the `<div className="flex items-center gap-2">` save row, add:

```typescript
          {projectTasks.length > 0 && (
            <div>
              <span className="text-zinc-600">blocks on:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {projectTasks.map((pt) => (
                  <label key={pt.id} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editDeps.includes(pt.id)}
                      onChange={(e) =>
                        setEditDeps((prev) =>
                          e.target.checked
                            ? [...prev, pt.id]
                            : prev.filter((id) => id !== pt.id)
                        )
                      }
                      className="accent-emerald-500"
                    />
                    <span className={`text-xs ${pt.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-400'}`}>
                      {pt.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
```

**f) Show dependency count in the collapsed row:**

In the non-editing row JSX, after the `{task.recurrence_rule && ...}` badge, add:
```typescript
        {task.dependency_ids && task.dependency_ids.length > 0 && (
          <span className="text-zinc-700 text-xs shrink-0" title="has dependencies">
            ⇢{task.dependency_ids.length}
          </span>
        )}
```

**g) Pass `projectTasks` from `ProjectCard` to `TaskRow`:**

In `ProjectCard`, change:
```typescript
            tasks.map((t) => <TaskRow key={t.id} task={t} />)
```
to:
```typescript
            tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                projectTasks={tasks.filter((pt) => pt.id !== t.id)}
              />
            ))
```

**Step 4: Verify TypeScript compiles**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors. Fix any type errors before continuing.

**Step 5: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

Expected: all passing.

**Step 6: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/tasks.ts frontend/src/views/Projects.tsx
git commit -m "feat: task dependency picker UI in project task editor"
```

---

## Task 4: Whoop — Models, Migration, Config

**Files:**
- Create: `backend/models/whoop_token.py`
- Create: `backend/models/whoop_daily.py`
- Modify: `backend/models/__init__.py`
- Create: `alembic/versions/b2c3d4e5f6a7_add_whoop.py`
- Modify: `backend/config.py`
- Create: `tests/models/test_whoop_models.py`

**Step 1: Write failing tests**

Create `tests/models/test_whoop_models.py`:

```python
import uuid
from datetime import datetime, date
from backend.models.whoop_token import WhoopToken
from backend.models.whoop_daily import WhoopDaily


def test_whoop_token_model(db):
    token = WhoopToken(
        id=str(uuid.uuid4()),
        access_token="tok_abc",
        refresh_token="ref_xyz",
        token_type="Bearer",
        expires_at=datetime(2026, 6, 1, 12, 0),
        scope="offline read:recovery",
    )
    db.add(token)
    db.commit()
    fetched = db.get(WhoopToken, token.id)
    assert fetched.access_token == "tok_abc"


def test_whoop_daily_model(db):
    daily = WhoopDaily(
        id=str(uuid.uuid4()),
        date=date(2026, 3, 2),
        recovery_score=73,
        hrv_rms=45.2,
        resting_hr=58,
        sleep_quality_score=82,
        strain_score=8.4,
        synced_at=datetime.utcnow(),
    )
    db.add(daily)
    db.commit()
    fetched = db.get(WhoopDaily, daily.id)
    assert fetched.recovery_score == 73
    assert fetched.strain_score == 8.4
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/models/test_whoop_models.py -v
```

Expected: FAIL — ModuleNotFoundError.

**Step 3: Create `backend/models/whoop_token.py`**

```python
import uuid
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class WhoopToken(Base):
    __tablename__ = "whoop_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    access_token: Mapped[str] = mapped_column(String(2000), nullable=False)
    refresh_token: Mapped[str] = mapped_column(String(2000), nullable=False)
    token_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Bearer")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    scope: Mapped[str] = mapped_column(String(500), nullable=False, default="")
```

**Step 4: Create `backend/models/whoop_daily.py`**

```python
import uuid
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class WhoopDaily(Base):
    __tablename__ = "whoop_daily"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    recovery_score: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 0–100
    hrv_rms: Mapped[float | None] = mapped_column(Float, nullable=True)
    resting_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_quality_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0–100
    actual_wake_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    strain_score: Mapped[float | None] = mapped_column(Float, nullable=True)      # 0–21
    synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
```

**Step 5: Register in `backend/models/__init__.py`**

Add:
```python
from backend.models.whoop_token import WhoopToken
from backend.models.whoop_daily import WhoopDaily
```

And add `"WhoopToken"`, `"WhoopDaily"` to `__all__`.

**Step 6: Create migration `alembic/versions/b2c3d4e5f6a7_add_whoop.py`**

```python
"""add_whoop

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-03-02

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'b2c3d4e5f6a7'
down_revision: Union[str, Sequence[str], None] = 'a1b2c3d4e5f6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'whoop_tokens',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('access_token', sa.String(2000), nullable=False),
        sa.Column('refresh_token', sa.String(2000), nullable=False),
        sa.Column('token_type', sa.String(50), nullable=False),
        sa.Column('expires_at', sa.DateTime(), nullable=False),
        sa.Column('scope', sa.String(500), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_table(
        'whoop_daily',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('recovery_score', sa.Integer(), nullable=True),
        sa.Column('hrv_rms', sa.Float(), nullable=True),
        sa.Column('resting_hr', sa.Integer(), nullable=True),
        sa.Column('sleep_quality_score', sa.Integer(), nullable=True),
        sa.Column('actual_wake_time', sa.DateTime(), nullable=True),
        sa.Column('strain_score', sa.Float(), nullable=True),
        sa.Column('synced_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('date'),
    )


def downgrade() -> None:
    op.drop_table('whoop_daily')
    op.drop_table('whoop_tokens')
```

**Step 7: Add Whoop config to `backend/config.py`**

Add these fields to the `Settings` class:

```python
    whoop_client_id: str = ""
    whoop_client_secret: str = ""
    whoop_redirect_uri: str = "http://localhost:8000/api/whoop/callback"
```

**Step 8: Run migration and tests**

```bash
source .venv/bin/activate && alembic upgrade head
pytest tests/models/test_whoop_models.py -v
```

Expected: migration runs cleanly, 2 tests pass.

**Step 9: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 10: Commit**

```bash
git add backend/models/whoop_token.py backend/models/whoop_daily.py backend/models/__init__.py alembic/versions/b2c3d4e5f6a7_add_whoop.py backend/config.py tests/models/test_whoop_models.py
git commit -m "feat: Whoop models, migration, and config"
```

---

## Task 5: Whoop API Client

**Files:**
- Create: `backend/integrations/whoop.py`
- Create: `tests/integrations/test_whoop_client.py`

**Step 1: Write failing tests**

Create `tests/integrations/test_whoop_client.py`:

```python
from unittest.mock import patch, MagicMock
from backend.integrations.whoop import WhoopClient


def _mock_response(json_data, status_code=200):
    mock = MagicMock()
    mock.status_code = status_code
    mock.json.return_value = json_data
    mock.raise_for_status = MagicMock()
    return mock


def test_get_auth_url():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    url = client.get_auth_url()
    assert "cid" in url
    assert "localhost" in url
    assert "read:recovery" in url


def test_exchange_code():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    mock_resp = _mock_response({
        "access_token": "acc",
        "refresh_token": "ref",
        "token_type": "Bearer",
        "expires_in": 3600,
        "scope": "offline read:recovery",
    })
    with patch("httpx.post", return_value=mock_resp):
        result = client.exchange_code("authcode123")
    assert result["access_token"] == "acc"


def test_get_latest_recovery():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    client.set_tokens("acc", "ref")
    mock_resp = _mock_response({"records": [{"score": {"recovery_score": 73, "resting_heart_rate": 58, "hrv_rms_sd": 45.2}}]})
    with patch("httpx.get", return_value=mock_resp):
        result = client.get_latest_recovery()
    assert result["score"]["recovery_score"] == 73


def test_get_latest_sleep():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    client.set_tokens("acc", "ref")
    mock_resp = _mock_response({"records": [{"end": "2026-03-02T07:23:00.000Z", "score": {"sleep_performance_percentage": 82}}]})
    with patch("httpx.get", return_value=mock_resp):
        result = client.get_latest_sleep()
    assert "end" in result


def test_get_latest_cycle():
    client = WhoopClient(client_id="cid", client_secret="csec", redirect_uri="http://localhost/cb")
    client.set_tokens("acc", "ref")
    mock_resp = _mock_response({"records": [{"score": {"strain": 14.2}}]})
    with patch("httpx.get", return_value=mock_resp):
        result = client.get_latest_cycle()
    assert result["score"]["strain"] == 14.2
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/integrations/test_whoop_client.py -v
```

Expected: FAIL — ModuleNotFoundError.

**Step 3: Create `backend/integrations/whoop.py`**

```python
from datetime import datetime, timedelta
from urllib.parse import urlencode
from typing import Any

import httpx

_AUTH_URL = "https://api.prod.whoop.com/oauth/oauth2/auth"
_TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token"
_API_BASE = "https://api.prod.whoop.com/developer/v1"
_SCOPES = "offline read:recovery read:sleep read:cycles"


class WhoopClient:
    def __init__(self, client_id: str, client_secret: str, redirect_uri: str) -> None:
        self._client_id = client_id
        self._client_secret = client_secret
        self._redirect_uri = redirect_uri
        self._access_token: str | None = None

    def set_tokens(self, access_token: str, refresh_token: str | None = None) -> None:
        self._access_token = access_token

    def get_auth_url(self) -> str:
        params = {
            "response_type": "code",
            "client_id": self._client_id,
            "redirect_uri": self._redirect_uri,
            "scope": _SCOPES,
        }
        return f"{_AUTH_URL}?{urlencode(params)}"

    def exchange_code(self, code: str) -> dict[str, Any]:
        resp = httpx.post(
            _TOKEN_URL,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self._redirect_uri,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        resp = httpx.post(
            _TOKEN_URL,
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self._client_id,
                "client_secret": self._client_secret,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def _headers(self) -> dict[str, str]:
        if not self._access_token:
            raise RuntimeError("No access token — call set_tokens() first")
        return {"Authorization": f"Bearer {self._access_token}"}

    def get_latest_recovery(self) -> dict[str, Any] | None:
        resp = httpx.get(
            f"{_API_BASE}/recovery/",
            params={"limit": 1},
            headers=self._headers(),
        )
        resp.raise_for_status()
        records = resp.json().get("records", [])
        return records[0] if records else None

    def get_latest_sleep(self) -> dict[str, Any] | None:
        resp = httpx.get(
            f"{_API_BASE}/activity/sleep/",
            params={"limit": 1},
            headers=self._headers(),
        )
        resp.raise_for_status()
        records = resp.json().get("records", [])
        return records[0] if records else None

    def get_latest_cycle(self) -> dict[str, Any] | None:
        resp = httpx.get(
            f"{_API_BASE}/cycle/",
            params={"limit": 1},
            headers=self._headers(),
        )
        resp.raise_for_status()
        records = resp.json().get("records", [])
        return records[0] if records else None
```

**Step 4: Create `tests/integrations/__init__.py`** (empty file so pytest finds the package)

**Step 5: Run tests**

```bash
pytest tests/integrations/test_whoop_client.py -v
```

Expected: 5 passed.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add backend/integrations/whoop.py tests/integrations/__init__.py tests/integrations/test_whoop_client.py
git commit -m "feat: Whoop API client (OAuth + recovery/sleep/cycle endpoints)"
```

---

## Task 6: Whoop API Routes + Sync Logic

**Files:**
- Create: `backend/api/whoop.py`
- Modify: `backend/main.py`
- Modify: `backend/api/schemas.py`
- Create: `tests/api/test_whoop.py`

**Step 1: Add schemas to `backend/api/schemas.py`**

Append at the end of the file:

```python
# --- Whoop ---

class WhoopStatusResponse(BaseModel):
    connected: bool
    today: dict | None = None  # WhoopDaily fields if synced today
```

**Step 2: Write failing tests**

Create `tests/api/test_whoop.py`:

```python
from unittest.mock import patch, MagicMock


def test_whoop_status_not_connected(client):
    r = client.get("/api/whoop/status")
    assert r.status_code == 200
    assert r.json()["connected"] is False
    assert r.json()["today"] is None


def test_whoop_connect_redirects(client):
    r = client.get("/api/whoop/connect", follow_redirects=False)
    assert r.status_code in (302, 307)
    assert "whoop.com" in r.headers.get("location", "")


def test_whoop_sync_no_token(client):
    r = client.post("/api/whoop/sync")
    assert r.status_code == 400


def test_whoop_sync_with_token(client):
    from datetime import datetime, timedelta, date
    import uuid
    from backend.models.whoop_token import WhoopToken
    from backend.db import SessionLocal

    db = SessionLocal()
    token = WhoopToken(
        id=str(uuid.uuid4()),
        access_token="test_access",
        refresh_token="test_refresh",
        token_type="Bearer",
        expires_at=datetime.utcnow() + timedelta(hours=1),
        scope="offline read:recovery",
    )
    db.add(token)
    db.commit()
    db.close()

    mock_recovery = {"score": {"recovery_score": 73, "resting_heart_rate": 58, "hrv_rms_sd": 45.2}}
    mock_sleep = {"end": "2026-03-02T07:23:00.000Z", "score": {"sleep_performance_percentage": 82}}
    mock_cycle = {"score": {"strain": 8.4}}

    with patch("backend.api.whoop.WhoopClient") as MockClient:
        mock_instance = MagicMock()
        MockClient.return_value = mock_instance
        mock_instance.get_latest_recovery.return_value = mock_recovery
        mock_instance.get_latest_sleep.return_value = mock_sleep
        mock_instance.get_latest_cycle.return_value = mock_cycle

        r = client.post("/api/whoop/sync")

    assert r.status_code == 200
    data = r.json()
    assert data["recovery_score"] == 73
```

**Step 3: Create `backend/api/whoop.py`**

```python
import uuid
from datetime import datetime, timedelta, date, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.config import settings
from backend.models.whoop_token import WhoopToken
from backend.models.whoop_daily import WhoopDaily
from backend.integrations.whoop import WhoopClient

router = APIRouter(prefix="/api/whoop", tags=["whoop"])


def _get_client() -> WhoopClient:
    return WhoopClient(
        client_id=settings.whoop_client_id,
        client_secret=settings.whoop_client_secret,
        redirect_uri=settings.whoop_redirect_uri,
    )


@router.get("/status")
def whoop_status(db: Session = Depends(get_db)):
    token = db.query(WhoopToken).first()
    if not token:
        return {"connected": False, "today": None}

    today = date.today()
    daily = db.query(WhoopDaily).filter(WhoopDaily.date == today).first()
    today_data = None
    if daily:
        today_data = {
            "recovery_score": daily.recovery_score,
            "hrv_rms": daily.hrv_rms,
            "resting_hr": daily.resting_hr,
            "sleep_quality_score": daily.sleep_quality_score,
            "strain_score": daily.strain_score,
            "actual_wake_time": daily.actual_wake_time.isoformat() if daily.actual_wake_time else None,
            "synced_at": daily.synced_at.isoformat(),
        }
    return {"connected": True, "today": today_data}


@router.get("/connect")
def whoop_connect():
    client = _get_client()
    return RedirectResponse(url=client.get_auth_url())


@router.get("/callback")
def whoop_callback(code: str, db: Session = Depends(get_db)):
    client = _get_client()
    try:
        token_data = client.exchange_code(code)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Token exchange failed: {e}")

    expires_at = datetime.utcnow() + timedelta(seconds=token_data.get("expires_in", 3600))

    # Upsert — only one token row
    token = db.query(WhoopToken).first()
    if token:
        token.access_token = token_data["access_token"]
        token.refresh_token = token_data.get("refresh_token", token.refresh_token)
        token.expires_at = expires_at
        token.scope = token_data.get("scope", "")
    else:
        token = WhoopToken(
            id=str(uuid.uuid4()),
            access_token=token_data["access_token"],
            refresh_token=token_data.get("refresh_token", ""),
            token_type=token_data.get("token_type", "Bearer"),
            expires_at=expires_at,
            scope=token_data.get("scope", ""),
        )
        db.add(token)
    db.commit()

    # Redirect to frontend after successful connect
    return RedirectResponse(url="http://localhost:5173/?whoop=connected")


@router.post("/sync")
def whoop_sync(db: Session = Depends(get_db)):
    token = db.query(WhoopToken).first()
    if not token:
        raise HTTPException(status_code=400, detail="Whoop not connected. Visit /api/whoop/connect first.")

    client = _get_client()
    client.set_tokens(token.access_token, token.refresh_token)

    recovery = client.get_latest_recovery()
    sleep = client.get_latest_sleep()
    cycle = client.get_latest_cycle()

    today = date.today()

    recovery_score = None
    hrv_rms = None
    resting_hr = None
    if recovery:
        score = recovery.get("score", {})
        recovery_score = score.get("recovery_score")
        hrv_rms = score.get("hrv_rms_sd")
        resting_hr = score.get("resting_heart_rate")

    sleep_quality_score = None
    actual_wake_time = None
    if sleep:
        score = sleep.get("score", {})
        sleep_quality_score = score.get("sleep_performance_percentage")
        end_str = sleep.get("end")
        if end_str:
            try:
                actual_wake_time = datetime.fromisoformat(end_str.replace("Z", "+00:00")).replace(tzinfo=None)
            except ValueError:
                pass

    strain_score = None
    if cycle:
        score = cycle.get("score", {})
        strain_score = score.get("strain")

    # Upsert WhoopDaily for today
    daily = db.query(WhoopDaily).filter(WhoopDaily.date == today).first()
    if daily:
        daily.recovery_score = recovery_score
        daily.hrv_rms = hrv_rms
        daily.resting_hr = resting_hr
        daily.sleep_quality_score = sleep_quality_score
        daily.actual_wake_time = actual_wake_time
        daily.strain_score = strain_score
        daily.synced_at = datetime.utcnow()
    else:
        daily = WhoopDaily(
            id=str(uuid.uuid4()),
            date=today,
            recovery_score=recovery_score,
            hrv_rms=hrv_rms,
            resting_hr=resting_hr,
            sleep_quality_score=sleep_quality_score,
            actual_wake_time=actual_wake_time,
            strain_score=strain_score,
            synced_at=datetime.utcnow(),
        )
        db.add(daily)
    db.commit()
    db.refresh(daily)

    return {
        "recovery_score": daily.recovery_score,
        "hrv_rms": daily.hrv_rms,
        "resting_hr": daily.resting_hr,
        "sleep_quality_score": daily.sleep_quality_score,
        "strain_score": daily.strain_score,
        "actual_wake_time": daily.actual_wake_time.isoformat() if daily.actual_wake_time else None,
        "synced_at": daily.synced_at.isoformat(),
    }
```

**Step 4: Wire router in `backend/main.py`**

Add import:
```python
from backend.api.whoop import router as whoop_router
```

Add:
```python
app.include_router(whoop_router)
```

**Step 5: Run tests**

```bash
source .venv/bin/activate && pytest tests/api/test_whoop.py -v
```

Expected: 4 passed.

**Step 6: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add backend/api/whoop.py backend/main.py backend/api/schemas.py tests/api/test_whoop.py
git commit -m "feat: Whoop API routes — OAuth connect/callback, sync, status"
```

---

## Task 7: Whoop Scheduler Integration + Context Snapshot

**Files:**
- Modify: `backend/scheduler/engine.py`
- Modify: `backend/api/schedule.py`
- Modify: `backend/intelligence/context.py`
- Modify: `tests/scheduler/test_engine.py`
- Modify: `tests/intelligence/test_client.py`

**Step 1: Write failing tests**

In `tests/scheduler/test_engine.py`, append:

```python
def test_recovery_multiplier_reduces_energy_weight():
    """With low recovery, load=3 tasks should score lower and get worse slots."""
    # This is a smoke test — just verify the engine accepts recovery_multiplier
    # and runs without error.
    from backend.scheduler.engine import SchedulerEngine
    from datetime import datetime, date, time
    import uuid

    class _Task:
        id = str(uuid.uuid4())
        project_id = "p1"
        title = "Deep task"
        status = "active"
        cognitive_load = 3
        estimated_minutes = 60
        deadline = None
        created_at = datetime(2026, 1, 1)
        dependencies = []

    engine = SchedulerEngine()
    # Should not raise with recovery_multiplier parameter
    results = engine.run(
        tasks=[_Task()],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        recovery_multiplier=0.6,
    )
    # Results may be empty or have blocks — just verify no crash
    assert isinstance(results, list)
```

In `tests/intelligence/test_client.py`, append:

```python
def test_context_snapshot_includes_whoop_today(db):
    from backend.intelligence.context import build_context_snapshot
    snapshot = build_context_snapshot(db)
    assert "whoop_today" in snapshot
    # No Whoop data in test DB — should return None
    assert snapshot["whoop_today"] is None
```

**Step 2: Run to verify they fail**

```bash
source .venv/bin/activate
pytest tests/scheduler/test_engine.py::test_recovery_multiplier_reduces_energy_weight tests/intelligence/test_client.py::test_context_snapshot_includes_whoop_today -v
```

Expected: FAIL.

**Step 3: Add `recovery_multiplier` to `backend/scheduler/engine.py`**

In `SchedulerEngine.run()`, add `recovery_multiplier: float = 1.0` to the signature:

```python
    def run(
        self,
        tasks: list,
        fixed_blocks: list,
        energy_profiles: list,
        availability_windows: list,
        now: datetime | None = None,
        start_date: date | None = None,
        correction_factors: dict | None = None,
        recovery_multiplier: float = 1.0,
    ) -> list[ScheduleBlockResult]:
```

Then, after the existing `energy_map` is built (currently: `energy_map = {s.absolute_index: get_slot_energy(s, energy_profiles) for s in slots}`), apply the multiplier:

```python
        energy_map = {
            s.absolute_index: max(1, round(get_slot_energy(s, energy_profiles) * recovery_multiplier))
            for s in slots
        }
```

**Step 4: Pass `recovery_multiplier` in `backend/api/schedule.py`**

In `_run_scheduler_job`, load today's Whoop data and compute the multiplier before calling `run_engine`. Find the `run_engine(db)` call and replace that section:

```python
def _recovery_multiplier(recovery_score: int) -> float:
    if recovery_score < 34:
        return 0.6   # red — significant reduction
    if recovery_score < 67:
        return 0.85  # yellow — moderate reduction
    return 1.0       # green — full energy


def _run_scheduler_job(db: Session, now=None) -> dict:
    from backend.models.whoop_daily import WhoopDaily
    from datetime import date as _date

    # Determine recovery multiplier from today's Whoop data
    today_whoop = db.query(WhoopDaily).filter(WhoopDaily.date == _date.today()).first()
    recovery_mult = 1.0
    if today_whoop and today_whoop.recovery_score is not None:
        recovery_mult = _recovery_multiplier(today_whoop.recovery_score)

    # ... (rest of existing _run_scheduler_job: load tasks, blocks, profiles, etc.)
    # Pass recovery_multiplier to run():
    results = engine.run(
        tasks=schedulable_tasks,
        fixed_blocks=fixed_blocks,
        energy_profiles=profiles,
        availability_windows=windows,
        now=effective_now,
        correction_factors=correction_factors,
        recovery_multiplier=recovery_mult,
    )
```

**Important:** Read `backend/api/schedule.py` first to find the exact structure of `_run_scheduler_job` before editing. Only add the `recovery_multiplier` pieces — do not restructure the existing logic.

**Step 5: Add `whoop_today` to `backend/intelligence/context.py`**

Add `_build_whoop_today` function:

```python
def _build_whoop_today(db: Session, now: datetime) -> dict | None:
    from backend.models.whoop_daily import WhoopDaily
    today = now.date()
    daily = db.query(WhoopDaily).filter(WhoopDaily.date == today).first()
    if not daily:
        return None
    rec = daily.recovery_score
    recommendation = "green" if rec and rec >= 67 else ("yellow" if rec and rec >= 34 else "red") if rec else None
    return {
        "recovery_score": daily.recovery_score,
        "hrv_rms": daily.hrv_rms,
        "resting_hr": daily.resting_hr,
        "sleep_quality_score": daily.sleep_quality_score,
        "strain_score": daily.strain_score,
        "actual_wake_time": daily.actual_wake_time.strftime("%H:%M") if daily.actual_wake_time else None,
        "recommendation": recommendation,
    }
```

Add to `build_context_snapshot` return dict:
```python
        "whoop_today": _build_whoop_today(db, now),
```

**Step 6: Run tests**

```bash
pytest tests/scheduler/test_engine.py::test_recovery_multiplier_reduces_energy_weight tests/intelligence/test_client.py::test_context_snapshot_includes_whoop_today -v
```

Expected: 2 passed.

**Step 7: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 8: Commit**

```bash
git add backend/scheduler/engine.py backend/api/schedule.py backend/intelligence/context.py tests/scheduler/test_engine.py tests/intelligence/test_client.py
git commit -m "feat: Whoop recovery score drives scheduler energy multiplier + context snapshot"
```

---

## Task 8: Whoop Settings UI + Frontend Types

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/api/whoop.ts`
- Modify: `frontend/src/views/Settings.tsx`

**Step 1: Add types to `frontend/src/types.ts`**

Append at the end:

```typescript
export interface WhoopToday {
  recovery_score: number | null
  hrv_rms: number | null
  resting_hr: number | null
  sleep_quality_score: number | null
  strain_score: number | null
  actual_wake_time: string | null
  recommendation: 'red' | 'yellow' | 'green' | null
}

export interface WhoopStatus {
  connected: boolean
  today: WhoopToday | null
}
```

**Step 2: Create `frontend/src/api/whoop.ts`**

```typescript
import { apiFetch } from './client'
import type { WhoopStatus } from '../types'

export const getWhoopStatus = () =>
  apiFetch<WhoopStatus>('/whoop/status')

export const syncWhoop = () =>
  apiFetch<Record<string, unknown>>('/whoop/sync', { method: 'POST' })

// Connect navigates the browser to the OAuth URL — not an apiFetch call
export const connectWhoop = () => {
  window.location.href = `${import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'}/api/whoop/connect`
}
```

**Step 3: Add `WhoopSection` to `frontend/src/views/Settings.tsx`**

Read Settings.tsx first.

Add these imports at the top:
```typescript
import { getWhoopStatus, syncWhoop, connectWhoop } from '../api/whoop'
import type { WhoopStatus } from '../types'
```

Add the `WhoopSection` component before `ChronotypeSection`:

```typescript
const RECOVERY_COLORS: Record<string, string> = {
  green: 'text-emerald-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
}

function WhoopSection() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['whoop-status'],
    queryFn: getWhoopStatus,
    refetchInterval: 5 * 60_000,  // refresh every 5 min
  })

  const { mutate: sync, isPending: syncing } = useMutation({
    mutationFn: syncWhoop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whoop-status'] }),
  })

  if (isLoading) return <div className="text-zinc-600 text-xs">loading...</div>

  if (!status?.connected) {
    return (
      <div className="space-y-2">
        <p className="text-zinc-600 text-xs">
          Connect Whoop to automatically adjust your energy profile based on daily recovery score.
          Requires <code className="text-zinc-400">WHOOP_CLIENT_ID</code> and{' '}
          <code className="text-zinc-400">WHOOP_CLIENT_SECRET</code> in your{' '}
          <code className="text-zinc-400">.env</code>.
        </p>
        <button
          onClick={connectWhoop}
          className="text-xs text-emerald-400 hover:text-emerald-300 border border-zinc-700 px-2 py-0.5 transition-colors"
        >
          [ connect whoop ]
        </button>
      </div>
    )
  }

  const today = status.today
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-emerald-600 text-xs">● connected</span>
        <button
          onClick={() => sync()}
          disabled={syncing}
          className="text-xs text-zinc-600 hover:text-zinc-400 disabled:text-zinc-800 transition-colors"
        >
          {syncing ? 'syncing...' : '[ sync now ]'}
        </button>
      </div>

      {today ? (
        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
          <div>
            <span className="text-zinc-600">recovery </span>
            <span className={today.recommendation ? RECOVERY_COLORS[today.recommendation] : 'text-zinc-400'}>
              {today.recovery_score ?? '—'}%
            </span>
          </div>
          <div>
            <span className="text-zinc-600">hrv </span>
            <span className="text-zinc-300">{today.hrv_rms?.toFixed(1) ?? '—'}</span>
          </div>
          <div>
            <span className="text-zinc-600">rhr </span>
            <span className="text-zinc-300">{today.resting_hr ?? '—'}</span>
          </div>
          <div>
            <span className="text-zinc-600">strain </span>
            <span className="text-zinc-300">{today.strain_score?.toFixed(1) ?? '—'}</span>
          </div>
          <div>
            <span className="text-zinc-600">sleep </span>
            <span className="text-zinc-300">{today.sleep_quality_score ?? '—'}%</span>
          </div>
          <div>
            <span className="text-zinc-600">woke </span>
            <span className="text-zinc-300">{today.actual_wake_time ?? '—'}</span>
          </div>
        </div>
      ) : (
        <p className="text-zinc-700 text-xs">no data for today — sync to fetch</p>
      )}
    </div>
  )
}
```

**Step 4: Add Whoop section to the Settings view**

In the `Settings` component return, add Whoop as the FIRST section (before Chronotype):

```typescript
        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Whoop
          </h2>
          <WhoopSection />
        </section>
```

**Step 5: Verify TypeScript compiles**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors. Fix any issues before committing.

**Step 6: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

Expected: all passing.

**Step 7: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/whoop.ts frontend/src/views/Settings.tsx
git commit -m "feat: Whoop Settings UI — connect, sync, today's recovery metrics"
```

---

## Summary

After all 8 tasks:
- Recurring tasks spawn with correct next deadlines (daily/weekly/biweekly/monthly offsets from original deadline)
- Task dependencies are editable via checkboxes in the edit panel, visible as ⇢N badge in collapsed rows
- Whoop OAuth flow stored in DB; daily sync fetches recovery/sleep/strain
- Scheduler applies recovery multiplier (0.6 red / 0.85 yellow / 1.0 green) to energy map before optimization
- LLM context includes `whoop_today` with recovery score, HRV, strain, wake time, and red/yellow/green recommendation
- Settings shows Whoop panel with connect button or today's live metrics
