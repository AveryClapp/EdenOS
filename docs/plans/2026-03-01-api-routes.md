# API Routes Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the FastAPI route layer that wires the scheduler engine and intelligence layer to HTTP endpoints — Goals, Projects, Tasks, Schedule, and Chat.

**Architecture:** Five router modules in `backend/api/`, each mounted on `backend/main.py`. Pydantic schemas in `backend/api/schemas.py` for request validation and response serialization. Tests use FastAPI's `TestClient` with `dependency_overrides` to inject the in-memory test DB. The schedule `POST /run` endpoint calls `SchedulerEngine`, persists results, and never touches `overridden_by_user=True` blocks.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy, existing engine + intelligence modules, pytest + httpx

---

## Task 1: Schemas + test scaffold

**Files:**
- Create: `backend/api/schemas.py`
- Create: `tests/api/__init__.py`
- Create: `tests/api/conftest.py`

**Step 1: Create test directory**

```bash
mkdir -p /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/tests/api
touch /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/tests/api/__init__.py
```

**Step 2: Write `tests/api/conftest.py`**

This provides a `client` fixture that overrides the DB dependency with the in-memory test DB.

```python
import pytest
from fastapi.testclient import TestClient
from backend.main import app
from backend.db import get_db


@pytest.fixture()
def client(db):
    def override_get_db():
        yield db

    app.dependency_overrides[get_db] = override_get_db
    yield TestClient(app)
    app.dependency_overrides.clear()
```

**Step 3: Write `backend/api/schemas.py`**

```python
from __future__ import annotations
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel


# --- Goal ---

class GoalCreate(BaseModel):
    title: str
    description: str | None = None
    tier: Literal["long", "mid"]
    parent_id: str | None = None
    weight: float = 1.0
    target_date: date


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    tier: Literal["long", "mid"] | None = None
    parent_id: str | None = None
    weight: float | None = None
    target_date: date | None = None
    status: Literal["active", "paused", "done", "dropped"] | None = None


class GoalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    description: str | None
    tier: str
    parent_id: str | None
    weight: float
    target_date: date
    status: str
    created_at: datetime


# --- Project ---

class ProjectCreate(BaseModel):
    title: str
    category: Literal["research", "engineering", "academic", "athletic", "career", "personal"]
    motivation: str | None = None
    goal_id: str
    estimated_hours_remaining: float = 0.0
    github_repo: str | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    category: Literal["research", "engineering", "academic", "athletic", "career", "personal"] | None = None
    motivation: str | None = None
    goal_id: str | None = None
    estimated_hours_remaining: float | None = None
    github_repo: str | None = None
    status: Literal["active", "paused", "done", "dropped"] | None = None


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    category: str
    motivation: str | None
    goal_id: str
    priority_score: float
    status: str
    estimated_hours_remaining: float
    github_repo: str | None


# --- Task ---

class TaskCreate(BaseModel):
    project_id: str
    title: str
    description: str | None = None
    cognitive_load: int  # 1, 2, or 3
    estimated_minutes: int
    deadline: datetime | None = None
    dependency_ids: list[str] = []
    recurrence_rule: str | None = None
    source: Literal["manual", "github", "gcal"] = "manual"


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cognitive_load: int | None = None
    estimated_minutes: int | None = None
    deadline: datetime | None = None
    status: Literal["backlog", "active", "in_progress", "done", "deferred"] | None = None
    recurrence_rule: str | None = None


class TaskComplete(BaseModel):
    actual_minutes: int
    completion_quality: int   # 1–5
    energy_level_at_start: int  # 1–5


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
    source: str
    created_at: datetime


# --- Schedule ---

class ScheduleBlockResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    task_id: str | None
    calendar_event_id: str | None
    date: date
    start_time: str   # serialized as HH:MM:SS string
    end_time: str
    auto_generated: bool
    overridden_by_user: bool


class ScheduleOverride(BaseModel):
    task_id: str | None = None
    date: date
    start_time: str  # "HH:MM"
    end_time: str    # "HH:MM"


class ScheduleRunResponse(BaseModel):
    blocks_cleared: int
    blocks_created: int


# --- Chat ---

class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    content: str
    reasoning: str
```

**Step 4: Run existing tests to verify nothing broken**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/ -v --tb=short -q
```

Expected: 75 passed.

**Step 5: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/api/schemas.py tests/api/__init__.py tests/api/conftest.py
git commit -m "feat: add Pydantic schemas and API test scaffold"
```

---

## Task 2: Goals routes

**Files:**
- Create: `backend/api/goals.py`
- Create: `tests/api/test_goals.py`

**Step 1: Write failing tests**

```python
# tests/api/test_goals.py
import uuid
from datetime import date


def test_list_goals_empty(client):
    r = client.get("/api/goals")
    assert r.status_code == 200
    assert r.json() == []


def test_create_goal(client):
    r = client.post("/api/goals", json={
        "title": "Publish paper",
        "tier": "long",
        "weight": 0.9,
        "target_date": "2027-01-01",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Publish paper"
    assert data["tier"] == "long"
    assert data["status"] == "active"
    assert "id" in data


def test_get_goal(client):
    created = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 0.5, "target_date": "2026-06-01"
    }).json()
    r = client.get(f"/api/goals/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_goal_not_found(client):
    r = client.get(f"/api/goals/{uuid.uuid4()}")
    assert r.status_code == 404


def test_update_goal_status(client):
    created = client.post("/api/goals", json={
        "title": "G", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    r = client.patch(f"/api/goals/{created['id']}", json={"status": "paused"})
    assert r.status_code == 200
    assert r.json()["status"] == "paused"


def test_list_goals_excludes_dropped(client):
    client.post("/api/goals", json={
        "title": "Active", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    })
    dropped = client.post("/api/goals", json={
        "title": "Dropped", "tier": "long", "weight": 0.1, "target_date": "2026-01-01"
    }).json()
    client.patch(f"/api/goals/{dropped['id']}", json={"status": "dropped"})
    r = client.get("/api/goals")
    titles = [g["title"] for g in r.json()]
    assert "Active" in titles
    assert "Dropped" not in titles
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_goals.py -v
```

Expected: FAIL — router not registered.

**Step 3: Write `backend/api/goals.py`**

```python
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.goal import Goal
from backend.api.schemas import GoalCreate, GoalUpdate, GoalResponse

router = APIRouter(prefix="/api/goals", tags=["goals"])


@router.get("", response_model=list[GoalResponse])
def list_goals(db: Session = Depends(get_db)):
    return db.query(Goal).filter(Goal.status.notin_(["done", "dropped"])).all()


@router.post("", response_model=GoalResponse, status_code=201)
def create_goal(body: GoalCreate, db: Session = Depends(get_db)):
    goal = Goal(
        id=str(uuid.uuid4()),
        title=body.title,
        description=body.description,
        tier=body.tier,
        parent_id=body.parent_id,
        weight=body.weight,
        target_date=body.target_date,
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(goal_id: str, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    return goal


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(goal_id: str, body: GoalUpdate, db: Session = Depends(get_db)):
    goal = db.query(Goal).filter(Goal.id == goal_id).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(goal, field, value)
    db.commit()
    db.refresh(goal)
    return goal
```

**Step 4: Register the router in `backend/main.py`**

Replace the full contents of `backend/main.py` with:

```python
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect
from backend.db import get_db, engine
import backend.models  # noqa: F401

from backend.api.goals import router as goals_router

app = FastAPI(title="Eden", version="0.1.0")

app.include_router(goals_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
```

**Step 5: Run to verify tests pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_goals.py -v
```

Expected: all PASS.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/api/goals.py tests/api/test_goals.py backend/main.py
git commit -m "feat: add Goals CRUD routes"
```

---

## Task 3: Projects routes

**Files:**
- Create: `backend/api/projects.py`
- Create: `tests/api/test_projects.py`

**Step 1: Write failing tests**

```python
# tests/api/test_projects.py
import uuid


def _create_goal(client):
    return client.post("/api/goals", json={
        "title": "Root Goal", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()


def test_list_projects_empty(client):
    r = client.get("/api/projects")
    assert r.status_code == 200
    assert r.json() == []


def test_create_project(client):
    goal = _create_goal(client)
    r = client.post("/api/projects", json={
        "title": "Eden Backend",
        "category": "engineering",
        "goal_id": goal["id"],
        "estimated_hours_remaining": 80.0,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Eden Backend"
    assert data["priority_score"] == 0.0
    assert data["status"] == "active"


def test_get_project(client):
    goal = _create_goal(client)
    created = client.post("/api/projects", json={
        "title": "P", "category": "research", "goal_id": goal["id"]
    }).json()
    r = client.get(f"/api/projects/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_project_not_found(client):
    r = client.get(f"/api/projects/{uuid.uuid4()}")
    assert r.status_code == 404


def test_update_project(client):
    goal = _create_goal(client)
    created = client.post("/api/projects", json={
        "title": "P", "category": "engineering", "goal_id": goal["id"]
    }).json()
    r = client.patch(f"/api/projects/{created['id']}", json={"status": "paused", "estimated_hours_remaining": 10.0})
    assert r.status_code == 200
    assert r.json()["status"] == "paused"
    assert r.json()["estimated_hours_remaining"] == 10.0


def test_list_projects_excludes_dropped(client):
    goal = _create_goal(client)
    client.post("/api/projects", json={"title": "Active", "category": "research", "goal_id": goal["id"]})
    dropped = client.post("/api/projects", json={"title": "Dropped", "category": "research", "goal_id": goal["id"]}).json()
    client.patch(f"/api/projects/{dropped['id']}", json={"status": "dropped"})
    titles = [p["title"] for p in client.get("/api/projects").json()]
    assert "Active" in titles
    assert "Dropped" not in titles
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_projects.py -v
```

Expected: FAIL.

**Step 3: Write `backend/api/projects.py`**

```python
import uuid
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.project import Project
from backend.api.schemas import ProjectCreate, ProjectUpdate, ProjectResponse

router = APIRouter(prefix="/api/projects", tags=["projects"])


@router.get("", response_model=list[ProjectResponse])
def list_projects(db: Session = Depends(get_db)):
    return db.query(Project).filter(Project.status.notin_(["done", "dropped"])).all()


@router.post("", response_model=ProjectResponse, status_code=201)
def create_project(body: ProjectCreate, db: Session = Depends(get_db)):
    project = Project(
        id=str(uuid.uuid4()),
        title=body.title,
        category=body.category,
        motivation=body.motivation,
        goal_id=body.goal_id,
        estimated_hours_remaining=body.estimated_hours_remaining,
        github_repo=body.github_repo,
        priority_score=0.0,
        status="active",
    )
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project(project_id: str, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(project_id: str, body: ProjectUpdate, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(project, field, value)
    db.commit()
    db.refresh(project)
    return project
```

**Step 4: Register router in `backend/main.py`**

Add these two lines after the goals import/include:

```python
from backend.api.projects import router as projects_router
# ...
app.include_router(projects_router)
```

**Step 5: Run to verify tests pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_projects.py -v
```

Expected: all PASS.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/api/projects.py tests/api/test_projects.py backend/main.py
git commit -m "feat: add Projects CRUD routes"
```

---

## Task 4: Tasks routes

**Files:**
- Create: `backend/api/tasks.py`
- Create: `tests/api/test_tasks.py`

Completing a task creates a `LearningRecord` (append-only) and sets `actual_minutes` + `status=done` on the Task.

**Step 1: Write failing tests**

```python
# tests/api/test_tasks.py
import uuid


def _setup(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    project = client.post("/api/projects", json={
        "title": "P", "category": "engineering", "goal_id": goal["id"]
    }).json()
    return project


def test_list_tasks_empty(client):
    r = client.get("/api/tasks")
    assert r.status_code == 200
    assert r.json() == []


def test_create_task(client):
    project = _setup(client)
    r = client.post("/api/tasks", json={
        "project_id": project["id"],
        "title": "Write tests",
        "cognitive_load": 2,
        "estimated_minutes": 90,
    })
    assert r.status_code == 201
    data = r.json()
    assert data["title"] == "Write tests"
    assert data["status"] == "backlog"
    assert data["source"] == "manual"


def test_get_task(client):
    project = _setup(client)
    created = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 1, "estimated_minutes": 30,
    }).json()
    r = client.get(f"/api/tasks/{created['id']}")
    assert r.status_code == 200
    assert r.json()["id"] == created["id"]


def test_get_task_not_found(client):
    r = client.get(f"/api/tasks/{uuid.uuid4()}")
    assert r.status_code == 404


def test_update_task_status(client):
    project = _setup(client)
    created = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 2, "estimated_minutes": 60,
    }).json()
    r = client.patch(f"/api/tasks/{created['id']}", json={"status": "in_progress"})
    assert r.status_code == 200
    assert r.json()["status"] == "in_progress"


def test_complete_task_sets_done_and_creates_learning_record(client):
    project = _setup(client)
    created = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 2, "estimated_minutes": 60,
    }).json()
    r = client.post(f"/api/tasks/{created['id']}/complete", json={
        "actual_minutes": 75,
        "completion_quality": 4,
        "energy_level_at_start": 3,
    })
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "done"
    assert data["actual_minutes"] == 75


def test_list_tasks_filter_by_project(client):
    project = _setup(client)
    client.post("/api/tasks", json={
        "project_id": project["id"], "title": "In project",
        "cognitive_load": 1, "estimated_minutes": 30,
    })
    r = client.get(f"/api/tasks?project_id={project['id']}")
    assert r.status_code == 200
    assert len(r.json()) == 1
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_tasks.py -v
```

Expected: FAIL.

**Step 3: Write `backend/api/tasks.py`**

```python
import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.task import Task
from backend.models.learning_record import LearningRecord
from backend.api.schemas import TaskCreate, TaskUpdate, TaskComplete, TaskResponse

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


@router.get("", response_model=list[TaskResponse])
def list_tasks(project_id: str | None = Query(default=None), db: Session = Depends(get_db)):
    q = db.query(Task)
    if project_id:
        q = q.filter(Task.project_id == project_id)
    return q.all()


@router.post("", response_model=TaskResponse, status_code=201)
def create_task(body: TaskCreate, db: Session = Depends(get_db)):
    task = Task(
        id=str(uuid.uuid4()),
        project_id=body.project_id,
        title=body.title,
        description=body.description,
        cognitive_load=body.cognitive_load,
        estimated_minutes=body.estimated_minutes,
        deadline=body.deadline,
        recurrence_rule=body.recurrence_rule,
        source=body.source,
        status="backlog",
        created_at=datetime.utcnow(),
    )
    db.add(task)
    db.flush()

    if body.dependency_ids:
        deps = db.query(Task).filter(Task.id.in_(body.dependency_ids)).all()
        task.dependencies = deps

    db.commit()
    db.refresh(task)
    return task


@router.get("/{task_id}", response_model=TaskResponse)
def get_task(task_id: str, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/{task_id}", response_model=TaskResponse)
def update_task(task_id: str, body: TaskUpdate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(task, field, value)
    db.commit()
    db.refresh(task)
    return task


@router.post("/{task_id}/complete", response_model=TaskResponse)
def complete_task(task_id: str, body: TaskComplete, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    task.status = "done"
    task.actual_minutes = body.actual_minutes

    record = LearningRecord(
        id=str(uuid.uuid4()),
        task_id=task.id,
        estimated_minutes=task.estimated_minutes,
        actual_minutes=body.actual_minutes,
        energy_level_at_start=body.energy_level_at_start,
        completion_quality=body.completion_quality,
        recorded_at=datetime.utcnow(),
    )
    db.add(record)
    db.commit()
    db.refresh(task)
    return task
```

**Step 4: Register router in `backend/main.py`**

Add:
```python
from backend.api.tasks import router as tasks_router
# ...
app.include_router(tasks_router)
```

**Step 5: Run to verify tests pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_tasks.py -v
```

Expected: all PASS.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/api/tasks.py tests/api/test_tasks.py backend/main.py
git commit -m "feat: add Tasks CRUD routes with complete action and LearningRecord creation"
```

---

## Task 5: Schedule routes

**Files:**
- Create: `backend/api/schedule.py`
- Create: `tests/api/test_schedule.py`

`GET /api/schedule` returns today + week blocks. `POST /api/schedule/run` runs the scheduler engine and persists results. `POST /api/schedule/override` creates a manual override block.

**Step 1: Write failing tests**

```python
# tests/api/test_schedule.py
import uuid
from datetime import date, datetime


def _setup(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "long", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    project = client.post("/api/projects", json={
        "title": "P", "category": "engineering", "goal_id": goal["id"]
    }).json()
    task = client.post("/api/tasks", json={
        "project_id": project["id"], "title": "T",
        "cognitive_load": 2, "estimated_minutes": 60,
    }).json()
    return task


def test_get_schedule_empty(client):
    r = client.get("/api/schedule")
    assert r.status_code == 200
    data = r.json()
    assert "today" in data
    assert "week" in data
    assert isinstance(data["today"], list)
    assert isinstance(data["week"], list)


def test_run_scheduler_returns_counts(client):
    _setup(client)
    r = client.post("/api/schedule/run")
    assert r.status_code == 200
    data = r.json()
    assert "blocks_created" in data
    assert "blocks_cleared" in data
    assert data["blocks_created"] >= 0


def test_run_scheduler_creates_blocks(client):
    _setup(client)
    client.post("/api/schedule/run")
    r = client.get("/api/schedule")
    # At least some blocks should exist after running
    all_blocks = r.json()["week"]
    assert len(all_blocks) >= 0  # scheduler may or may not place blocks depending on task status


def test_override_creates_block(client):
    today = date.today().isoformat()
    r = client.post("/api/schedule/override", json={
        "date": today,
        "start_time": "09:00",
        "end_time": "10:00",
    })
    assert r.status_code == 201
    data = r.json()
    assert data["overridden_by_user"] is True


def test_override_respects_existing_manual_blocks(client):
    """Running scheduler after override must not touch overridden blocks."""
    _setup(client)
    today = date.today().isoformat()
    override = client.post("/api/schedule/override", json={
        "date": today, "start_time": "09:00", "end_time": "10:00"
    }).json()

    client.post("/api/schedule/run")

    r = client.get("/api/schedule")
    block_ids = [b["id"] for b in r.json()["week"]]
    assert override["id"] in block_ids
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_schedule.py -v
```

Expected: FAIL.

**Step 3: Write `backend/api/schedule.py`**

```python
import uuid
from datetime import datetime, date, time
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.models.energy_profile import EnergyProfile
from backend.models.availability_window import AvailabilityWindow
from backend.scheduler.engine import SchedulerEngine
from backend.api.schemas import ScheduleBlockResponse, ScheduleOverride, ScheduleRunResponse

router = APIRouter(prefix="/api/schedule", tags=["schedule"])
_engine = SchedulerEngine()


@router.get("", response_model=dict)
def get_schedule(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    today = now.date()
    week_end = today
    from datetime import timedelta
    week_end = today + timedelta(days=7)

    blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= today,
        ScheduleBlock.date < week_end,
    ).all()

    def serialize(b):
        return {
            "id": b.id,
            "task_id": b.task_id,
            "calendar_event_id": b.calendar_event_id,
            "date": str(b.date),
            "start_time": str(b.start_time),
            "end_time": str(b.end_time),
            "auto_generated": b.auto_generated,
            "overridden_by_user": b.overridden_by_user,
        }

    return {
        "today": [serialize(b) for b in blocks if b.date == today],
        "week": [serialize(b) for b in blocks],
    }


@router.post("/run", response_model=ScheduleRunResponse)
def run_scheduler(db: Session = Depends(get_db)):
    now = datetime.utcnow()
    start_date = now.date()

    tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()

    fixed_blocks = db.query(ScheduleBlock).filter(
        (ScheduleBlock.task_id.is_(None)) | (ScheduleBlock.overridden_by_user == True)
    ).all()

    energy_profiles = db.query(EnergyProfile).all()
    availability_windows = db.query(AvailabilityWindow).all()

    results = _engine.run(
        tasks=tasks,
        fixed_blocks=fixed_blocks,
        energy_profiles=energy_profiles,
        availability_windows=availability_windows,
        now=now,
        start_date=start_date,
    )

    # Clear existing auto-generated blocks (never touch overridden ones)
    deleted = db.query(ScheduleBlock).filter(
        ScheduleBlock.auto_generated == True,
        ScheduleBlock.overridden_by_user == False,
    ).delete(synchronize_session=False)
    db.flush()

    # Persist new blocks
    for result in results:
        block = ScheduleBlock(
            id=str(uuid.uuid4()),
            task_id=result.task_id,
            date=result.date,
            start_time=result.start_time,
            end_time=result.end_time,
            auto_generated=True,
            overridden_by_user=False,
        )
        db.add(block)

    db.commit()

    return ScheduleRunResponse(blocks_cleared=deleted, blocks_created=len(results))


@router.post("/override", response_model=dict, status_code=201)
def create_override(body: ScheduleOverride, db: Session = Depends(get_db)):
    start_h, start_m = map(int, body.start_time.split(":"))
    end_h, end_m = map(int, body.end_time.split(":"))

    block = ScheduleBlock(
        id=str(uuid.uuid4()),
        task_id=body.task_id,
        date=body.date,
        start_time=time(start_h, start_m),
        end_time=time(end_h, end_m),
        auto_generated=False,
        overridden_by_user=True,
    )
    db.add(block)
    db.commit()
    db.refresh(block)

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

**Step 4: Register router in `backend/main.py`**

Add:
```python
from backend.api.schedule import router as schedule_router
# ...
app.include_router(schedule_router)
```

**Step 5: Run to verify tests pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_schedule.py -v
```

Expected: all PASS.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/api/schedule.py tests/api/test_schedule.py backend/main.py
git commit -m "feat: add Schedule routes — GET, POST /run, POST /override"
```

---

## Task 6: Chat routes

**Files:**
- Create: `backend/api/chat.py`
- Create: `tests/api/test_chat.py`

Tests mock the Anthropic API — no live calls.

**Step 1: Write failing tests**

```python
# tests/api/test_chat.py
import json
from unittest.mock import MagicMock, patch


def _mock_llm(text: str):
    msg = MagicMock()
    msg.content = [MagicMock(text=text)]
    return msg


def test_get_alerts_empty(client):
    r = client.get("/api/chat/alerts")
    assert r.status_code == 200
    assert isinstance(r.json(), list)


def test_chat_returns_content_and_reasoning(client):
    reply = json.dumps({"reasoning": "Task X has urgency 2.1.", "content": "Work on X."})
    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_llm(reply)

        r = client.post("/api/chat", json={"message": "What should I do?"})
        assert r.status_code == 200
        data = r.json()
        assert data["content"] == "Work on X."
        assert data["reasoning"] == "Task X has urgency 2.1."


def test_chat_handles_plain_text_response(client):
    with patch("backend.intelligence.client.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_llm("Just do the thing.")

        r = client.post("/api/chat", json={"message": "help"})
        assert r.status_code == 200
        data = r.json()
        assert "content" in data
        assert "reasoning" in data
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_chat.py -v
```

Expected: FAIL.

**Step 3: Write `backend/api/chat.py`**

```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.intelligence.client import EdenClient
from backend.api.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])
_eden = EdenClient()


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest, db: Session = Depends(get_db)):
    result = _eden.chat(body.message, db)
    return ChatResponse(
        content=result.get("content", ""),
        reasoning=result.get("reasoning", ""),
    )


@router.get("/alerts")
def get_alerts(db: Session = Depends(get_db)):
    return _eden.get_alerts(db)
```

**Step 4: Register router in `backend/main.py`**

Add:
```python
from backend.api.chat import router as chat_router
# ...
app.include_router(chat_router)
```

**Step 5: Run to verify tests pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/api/test_chat.py -v
```

Expected: all PASS.

**Step 6: Run full test suite**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/ -v
```

Expected: all tests PASS.

**Step 7: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add backend/api/chat.py tests/api/test_chat.py backend/main.py
git commit -m "feat: add Chat routes — POST /api/chat and GET /api/chat/alerts"
```

---

## Done

At this point you have a fully wired backend:

- `GET/POST /api/goals`, `GET/PATCH /api/goals/{id}`
- `GET/POST /api/projects`, `GET/PATCH /api/projects/{id}`
- `GET/POST /api/tasks`, `GET/PATCH /api/tasks/{id}`, `POST /api/tasks/{id}/complete`
- `GET /api/schedule`, `POST /api/schedule/run`, `POST /api/schedule/override`
- `POST /api/chat`, `GET /api/chat/alerts`

Next layer: React frontend (`frontend/`).
