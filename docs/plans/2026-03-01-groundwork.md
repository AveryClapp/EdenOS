# Groundwork Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stand up the full data layer for EdenOS — project scaffold, all six SQLAlchemy models, Alembic migrations, and FastAPI skeleton with DB dependency injection.

**Architecture:** SQLAlchemy 2.0 declarative models backed by SQLite, migrated via Alembic. FastAPI app wires up the DB session as a dependency. All models are tested in isolation against an in-memory SQLite DB before Alembic touches anything.

**Tech Stack:** Python 3.11+, FastAPI, SQLAlchemy 2.0, Alembic, Pydantic-Settings, pytest

---

## Task 1: Directory scaffold + pyproject.toml

**Files:**
- Create: `pyproject.toml`
- Create: `.env.example`
- Create: `backend/__init__.py`
- Create: `backend/api/__init__.py`
- Create: `backend/scheduler/__init__.py`
- Create: `backend/intelligence/__init__.py`
- Create: `backend/integrations/__init__.py`
- Create: `backend/models/__init__.py`
- Create: `tests/__init__.py`
- Create: `tests/models/__init__.py`
- Create: `docs/plans/.gitkeep`

**Step 1: Create directory tree**

```bash
mkdir -p backend/api backend/scheduler backend/intelligence backend/integrations backend/models
mkdir -p tests/models
touch backend/__init__.py backend/api/__init__.py backend/scheduler/__init__.py
touch backend/intelligence/__init__.py backend/integrations/__init__.py backend/models/__init__.py
touch tests/__init__.py tests/models/__init__.py
```

**Step 2: Write `pyproject.toml`**

```toml
[project]
name = "eden"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "fastapi>=0.115.0",
    "uvicorn[standard]>=0.30.0",
    "sqlalchemy>=2.0.0",
    "alembic>=1.13.0",
    "pydantic-settings>=2.0.0",
    "python-dotenv>=1.0.0",
]

[project.optional-dependencies]
dev = [
    "pytest>=8.0.0",
    "httpx>=0.27.0",
]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

**Step 3: Write `.env.example`**

```bash
# LLM
ANTHROPIC_API_KEY=

# Google Calendar
GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
GCAL_REDIRECT_URI=

# Microsoft Graph (Outlook)
MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=

# GitHub
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=

# App
DATABASE_URL=sqlite:///eden.db
SCHEDULER_INTERVAL_SECONDS=1800
SYNC_INTERVAL_SECONDS=600
LLM_MODEL=claude-opus-4-6
SECRET_KEY=
```

**Step 4: Install dependencies**

```bash
pip install -e ".[dev]"
```

Expected: installs without errors.

**Step 5: Commit**

```bash
git add pyproject.toml .env.example backend/ tests/ docs/
git commit -m "feat: scaffold project structure and pyproject.toml"
```

---

## Task 2: Settings + FastAPI skeleton

**Files:**
- Create: `backend/config.py`
- Create: `backend/main.py`
- Create: `tests/test_main.py`

**Step 1: Write `backend/config.py`**

```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    database_url: str = "sqlite:///eden.db"
    scheduler_interval_seconds: int = 1800
    sync_interval_seconds: int = 600
    llm_model: str = "claude-opus-4-6"
    secret_key: str = "dev-secret-change-in-prod"

    anthropic_api_key: str = ""
    gcal_client_id: str = ""
    gcal_client_secret: str = ""
    gcal_redirect_uri: str = ""
    ms_client_id: str = ""
    ms_client_secret: str = ""
    ms_tenant_id: str = ""
    github_client_id: str = ""
    github_client_secret: str = ""


settings = Settings()
```

**Step 2: Write failing test**

```python
# tests/test_main.py
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
```

**Step 3: Run test to verify it fails**

```bash
pytest tests/test_main.py::test_health_check -v
```

Expected: FAIL — `backend/main.py` doesn't exist yet.

**Step 4: Write `backend/main.py`**

```python
from fastapi import FastAPI

app = FastAPI(title="Eden", version="0.1.0")


@app.get("/health")
def health_check():
    return {"status": "ok"}
```

**Step 5: Run test to verify it passes**

```bash
pytest tests/test_main.py::test_health_check -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/config.py backend/main.py tests/test_main.py
git commit -m "feat: add settings, FastAPI skeleton, and health check"
```

---

## Task 3: SQLAlchemy Base + DB session

**Files:**
- Create: `backend/db.py`
- Create: `tests/conftest.py`

**Step 1: Write `backend/db.py`**

```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from backend.config import settings


class Base(DeclarativeBase):
    pass


engine = create_engine(
    settings.database_url,
    connect_args={"check_same_thread": False},  # SQLite only
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**Step 2: Write `tests/conftest.py`**

This fixture is used by all model tests. It creates a fresh in-memory DB per test.

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
from backend.db import Base


@pytest.fixture()
def db() -> Session:
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()
    Base.metadata.drop_all(engine)
```

**Step 3: Write failing test**

```python
# tests/test_db.py
from backend.db import Base, engine


def test_base_exists():
    assert Base is not None


def test_engine_connects():
    with engine.connect() as conn:
        assert conn is not None
```

**Step 4: Run test**

```bash
pytest tests/test_db.py -v
```

Expected: PASS (no models yet, just verifies engine + base work).

**Step 5: Commit**

```bash
git add backend/db.py tests/conftest.py tests/test_db.py
git commit -m "feat: add SQLAlchemy Base, engine, and session factory"
```

---

## Task 4: Goal model

**Files:**
- Create: `backend/models/goal.py`
- Create: `tests/models/test_goal.py`

**Step 1: Write failing test**

```python
# tests/models/test_goal.py
import uuid
from datetime import date, datetime
from backend.models.goal import Goal


def test_create_goal(db):
    goal = Goal(
        id=str(uuid.uuid4()),
        title="Publish ML paper",
        description="Submit to NeurIPS 2026",
        tier="long",
        weight=0.8,
        target_date=date(2026, 9, 1),
        status="active",
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)

    assert goal.id is not None
    assert goal.title == "Publish ML paper"
    assert goal.tier == "long"
    assert goal.created_at is not None


def test_goal_parent_child(db):
    parent = Goal(
        id=str(uuid.uuid4()),
        title="Long-term career",
        tier="long",
        weight=1.0,
        target_date=date(2027, 1, 1),
        status="active",
    )
    db.add(parent)
    db.commit()

    child = Goal(
        id=str(uuid.uuid4()),
        title="Q1 promotion prep",
        tier="mid",
        parent_id=parent.id,
        weight=0.6,
        target_date=date(2026, 4, 1),
        status="active",
    )
    db.add(child)
    db.commit()
    db.refresh(child)

    assert child.parent_id == parent.id
```

**Step 2: Run to verify it fails**

```bash
pytest tests/models/test_goal.py -v
```

Expected: FAIL — `backend/models/goal.py` not found.

**Step 3: Write `backend/models/goal.py`**

```python
import uuid
from datetime import date, datetime
from sqlalchemy import String, Float, Date, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    tier: Mapped[str] = mapped_column(Enum("long", "mid", name="goal_tier"), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("goals.id"), nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("active", "paused", "done", "dropped", name="goal_status"),
        nullable=False,
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    parent: Mapped["Goal | None"] = relationship("Goal", remote_side="Goal.id", back_populates="children")
    children: Mapped[list["Goal"]] = relationship("Goal", back_populates="parent")
    projects: Mapped[list["Project"]] = relationship("Project", back_populates="goal")
```

**Step 4: Update `tests/conftest.py`** — import Goal so Base knows about it before `create_all`

```python
# Add to the top of tests/conftest.py, after existing imports:
import backend.models.goal  # noqa: F401 — registers with Base.metadata
```

**Step 5: Run to verify it passes**

```bash
pytest tests/models/test_goal.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/models/goal.py tests/models/test_goal.py tests/conftest.py
git commit -m "feat: add Goal model with self-referential tree relationship"
```

---

## Task 5: Project model

**Files:**
- Create: `backend/models/project.py`
- Create: `tests/models/test_project.py`

**Step 1: Write failing test**

```python
# tests/models/test_project.py
import uuid
from datetime import date
from backend.models.goal import Goal
from backend.models.project import Project


def _make_goal(db):
    g = Goal(
        id=str(uuid.uuid4()),
        title="Root goal",
        tier="long",
        weight=1.0,
        target_date=date(2027, 1, 1),
        status="active",
    )
    db.add(g)
    db.commit()
    return g


def test_create_project(db):
    goal = _make_goal(db)
    project = Project(
        id=str(uuid.uuid4()),
        title="Eden backend",
        category="engineering",
        motivation="Ship the MVP",
        goal_id=goal.id,
        status="active",
        estimated_hours_remaining=80.0,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    assert project.id is not None
    assert project.priority_score == 0.0  # computed later by scheduler
    assert project.goal_id == goal.id
    assert project.github_repo is None


def test_project_category_enum(db):
    goal = _make_goal(db)
    for cat in ["research", "engineering", "academic", "athletic", "career", "personal"]:
        p = Project(
            id=str(uuid.uuid4()),
            title=f"Project {cat}",
            category=cat,
            motivation="test",
            goal_id=goal.id,
            status="active",
        )
        db.add(p)
    db.commit()
```

**Step 2: Run to verify it fails**

```bash
pytest tests/models/test_project.py -v
```

Expected: FAIL

**Step 3: Write `backend/models/project.py`**

```python
import uuid
from sqlalchemy import String, Float, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("research", "engineering", "academic", "athletic", "career", "personal", name="project_category"),
        nullable=False,
    )
    motivation: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    goal_id: Mapped[str] = mapped_column(String(36), ForeignKey("goals.id"), nullable=False)
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(
        Enum("active", "paused", "done", "dropped", name="project_status"),
        nullable=False,
        default="active",
    )
    estimated_hours_remaining: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    github_repo: Mapped[str | None] = mapped_column(String(500), nullable=True)

    goal: Mapped["Goal"] = relationship("Goal", back_populates="projects")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="project")
```

**Step 4: Update `tests/conftest.py`**

```python
# Add after existing model imports:
import backend.models.project  # noqa: F401
```

**Step 5: Run to verify it passes**

```bash
pytest tests/models/test_project.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/models/project.py tests/models/test_project.py tests/conftest.py
git commit -m "feat: add Project model"
```

---

## Task 6: Task model + dependency join table

**Files:**
- Create: `backend/models/task.py`
- Create: `tests/models/test_task.py`

The `dependencies` field (list of Task UUIDs) is implemented as a self-referential many-to-many using an association table.

**Step 1: Write failing test**

```python
# tests/models/test_task.py
import uuid
from datetime import date, datetime, timedelta
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task


def _setup(db):
    goal = Goal(
        id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
        target_date=date(2027, 1, 1), status="active"
    )
    project = Project(
        id=str(uuid.uuid4()), title="P", category="engineering",
        goal_id=goal.id, status="active"
    )
    db.add_all([goal, project])
    db.commit()
    return project


def test_create_task(db):
    project = _setup(db)
    task = Task(
        id=str(uuid.uuid4()),
        project_id=project.id,
        title="Write tests",
        cognitive_load=2,
        estimated_minutes=90,
        status="backlog",
        source="manual",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    assert task.id is not None
    assert task.actual_minutes is None
    assert task.deadline is None
    assert task.created_at is not None


def test_task_dependency(db):
    project = _setup(db)
    t1 = Task(
        id=str(uuid.uuid4()), project_id=project.id,
        title="First", cognitive_load=1, estimated_minutes=30,
        status="backlog", source="manual"
    )
    t2 = Task(
        id=str(uuid.uuid4()), project_id=project.id,
        title="Second", cognitive_load=1, estimated_minutes=30,
        status="backlog", source="manual"
    )
    db.add_all([t1, t2])
    db.commit()

    t2.dependencies.append(t1)
    db.commit()
    db.refresh(t2)

    assert len(t2.dependencies) == 1
    assert t2.dependencies[0].id == t1.id
```

**Step 2: Run to verify it fails**

```bash
pytest tests/models/test_task.py -v
```

Expected: FAIL

**Step 3: Write `backend/models/task.py`**

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Enum, ForeignKey, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


# Association table for task dependencies (self-referential M2M)
task_dependencies = Table(
    "task_dependencies",
    Base.metadata,
    Column("task_id", String(36), ForeignKey("tasks.id"), primary_key=True),
    Column("depends_on_id", String(36), ForeignKey("tasks.id"), primary_key=True),
)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    status: Mapped[str] = mapped_column(
        Enum("backlog", "active", "in_progress", "done", "deferred", name="task_status"),
        nullable=False,
        default="backlog",
    )
    cognitive_load: Mapped[int] = mapped_column(Integer, nullable=False)  # 1, 2, or 3
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    recurrence_rule: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(
        Enum("manual", "github", "gcal", name="task_source"),
        nullable=False,
        default="manual",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    project: Mapped["Project"] = relationship("Project", back_populates="tasks")

    dependencies: Mapped[list["Task"]] = relationship(
        "Task",
        secondary=task_dependencies,
        primaryjoin="Task.id == task_dependencies.c.task_id",
        secondaryjoin="Task.id == task_dependencies.c.depends_on_id",
        backref="dependents",
    )

    schedule_blocks: Mapped[list["ScheduleBlock"]] = relationship("ScheduleBlock", back_populates="task")
    learning_records: Mapped[list["LearningRecord"]] = relationship("LearningRecord", back_populates="task")
```

**Step 4: Update `tests/conftest.py`**

```python
import backend.models.task  # noqa: F401
```

**Step 5: Run to verify it passes**

```bash
pytest tests/models/test_task.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/models/task.py tests/models/test_task.py tests/conftest.py
git commit -m "feat: add Task model with self-referential dependency join table"
```

---

## Task 7: EnergyProfile model

**Files:**
- Create: `backend/models/energy_profile.py`
- Create: `tests/models/test_energy_profile.py`

**Step 1: Write failing test**

```python
# tests/models/test_energy_profile.py
import uuid
from backend.models.energy_profile import EnergyProfile


def test_create_energy_profile(db):
    ep = EnergyProfile(
        id=str(uuid.uuid4()),
        hour_of_day=9,
        day_of_week=0,  # Monday
        energy_level=5,
        is_post_hard_workout=False,
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)

    assert ep.id is not None
    assert ep.energy_level == 5
    assert ep.notes is None


def test_post_workout_flag(db):
    ep = EnergyProfile(
        id=str(uuid.uuid4()),
        hour_of_day=7,
        day_of_week=2,
        energy_level=2,
        is_post_hard_workout=True,
        notes="Ran 10k this morning",
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)

    assert ep.is_post_hard_workout is True
    assert ep.notes == "Ran 10k this morning"
```

**Step 2: Run to verify it fails**

```bash
pytest tests/models/test_energy_profile.py -v
```

Expected: FAIL

**Step 3: Write `backend/models/energy_profile.py`**

```python
import uuid
from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class EnergyProfile(Base):
    __tablename__ = "energy_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    hour_of_day: Mapped[int] = mapped_column(Integer, nullable=False)   # 0–23
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)   # 0 = Monday
    energy_level: Mapped[int] = mapped_column(Integer, nullable=False)  # 1–5
    is_post_hard_workout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
```

**Step 4: Update `tests/conftest.py`**

```python
import backend.models.energy_profile  # noqa: F401
```

**Step 5: Run to verify it passes**

```bash
pytest tests/models/test_energy_profile.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/models/energy_profile.py tests/models/test_energy_profile.py tests/conftest.py
git commit -m "feat: add EnergyProfile model"
```

---

## Task 8: ScheduleBlock model

**Files:**
- Create: `backend/models/schedule_block.py`
- Create: `tests/models/test_schedule_block.py`

**Step 1: Write failing test**

```python
# tests/models/test_schedule_block.py
import uuid
from datetime import date, time, datetime
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock


def _setup(db):
    goal = Goal(id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
                target_date=date(2027, 1, 1), status="active")
    project = Project(id=str(uuid.uuid4()), title="P", category="engineering",
                      goal_id=goal.id, status="active")
    task = Task(id=str(uuid.uuid4()), project_id=project.id, title="T",
                cognitive_load=2, estimated_minutes=60, status="backlog", source="manual")
    db.add_all([goal, project, task])
    db.commit()
    return task


def test_create_schedule_block_with_task(db):
    task = _setup(db)
    block = ScheduleBlock(
        id=str(uuid.uuid4()),
        task_id=task.id,
        date=date(2026, 3, 2),
        start_time=time(9, 0),
        end_time=time(10, 0),
        auto_generated=True,
        overridden_by_user=False,
    )
    db.add(block)
    db.commit()
    db.refresh(block)

    assert block.id is not None
    assert block.overridden_by_user is False
    assert block.calendar_event_id is None


def test_create_fixed_external_block(db):
    """A block with no task (external calendar event)."""
    block = ScheduleBlock(
        id=str(uuid.uuid4()),
        task_id=None,
        calendar_event_id="gcal-event-abc123",
        date=date(2026, 3, 2),
        start_time=time(14, 0),
        end_time=time(15, 0),
        auto_generated=False,
        overridden_by_user=False,
    )
    db.add(block)
    db.commit()
    db.refresh(block)

    assert block.task_id is None
    assert block.calendar_event_id == "gcal-event-abc123"
```

**Step 2: Run to verify it fails**

```bash
pytest tests/models/test_schedule_block.py -v
```

Expected: FAIL

**Step 3: Write `backend/models/schedule_block.py`**

```python
import uuid
from datetime import date, time
from sqlalchemy import String, Date, Time, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class ScheduleBlock(Base):
    __tablename__ = "schedule_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=True)
    calendar_event_id: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    auto_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    overridden_by_user: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    task: Mapped["Task | None"] = relationship("Task", back_populates="schedule_blocks")
```

**Step 4: Update `tests/conftest.py`**

```python
import backend.models.schedule_block  # noqa: F401
```

**Step 5: Run to verify it passes**

```bash
pytest tests/models/test_schedule_block.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/models/schedule_block.py tests/models/test_schedule_block.py tests/conftest.py
git commit -m "feat: add ScheduleBlock model"
```

---

## Task 9: LearningRecord model

**Files:**
- Create: `backend/models/learning_record.py`
- Create: `tests/models/test_learning_record.py`

**Step 1: Write failing test**

```python
# tests/models/test_learning_record.py
import uuid
from datetime import date, datetime
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.learning_record import LearningRecord


def _setup(db):
    goal = Goal(id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
                target_date=date(2027, 1, 1), status="active")
    project = Project(id=str(uuid.uuid4()), title="P", category="engineering",
                      goal_id=goal.id, status="active")
    task = Task(id=str(uuid.uuid4()), project_id=project.id, title="T",
                cognitive_load=2, estimated_minutes=60, status="done", source="manual")
    db.add_all([goal, project, task])
    db.commit()
    return task


def test_create_learning_record(db):
    task = _setup(db)
    record = LearningRecord(
        id=str(uuid.uuid4()),
        task_id=task.id,
        estimated_minutes=60,
        actual_minutes=75,
        energy_level_at_start=4,
        completion_quality=4,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    assert record.id is not None
    assert record.actual_minutes == 75
    assert record.recorded_at is not None


def test_learning_records_are_independent(db):
    """Multiple records per task — append-only, never update existing."""
    task = _setup(db)
    for actual in [50, 65, 70]:
        record = LearningRecord(
            id=str(uuid.uuid4()),
            task_id=task.id,
            estimated_minutes=60,
            actual_minutes=actual,
            energy_level_at_start=3,
            completion_quality=3,
        )
        db.add(record)
    db.commit()

    from backend.models.learning_record import LearningRecord as LR
    records = db.query(LR).filter(LR.task_id == task.id).all()
    assert len(records) == 3
```

**Step 2: Run to verify it fails**

```bash
pytest tests/models/test_learning_record.py -v
```

Expected: FAIL

**Step 3: Write `backend/models/learning_record.py`**

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class LearningRecord(Base):
    """Append-only. Never update or delete rows — add new rows for new data."""
    __tablename__ = "learning_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    energy_level_at_start: Mapped[int] = mapped_column(Integer, nullable=False)  # 1–5
    completion_quality: Mapped[int] = mapped_column(Integer, nullable=False)     # 1–5
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    task: Mapped["Task"] = relationship("Task", back_populates="learning_records")
```

**Step 4: Update `tests/conftest.py`**

```python
import backend.models.learning_record  # noqa: F401
```

**Step 5: Run to verify it passes**

```bash
pytest tests/models/test_learning_record.py -v
```

Expected: PASS

**Step 6: Commit**

```bash
git add backend/models/learning_record.py tests/models/test_learning_record.py tests/conftest.py
git commit -m "feat: add LearningRecord model (append-only)"
```

---

## Task 10: Wire up `backend/models/__init__.py`

**Files:**
- Modify: `backend/models/__init__.py`

Alembic needs to import all models so they're registered on `Base.metadata` when it generates migrations.

**Step 1: Write `backend/models/__init__.py`**

```python
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task, task_dependencies
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord

__all__ = [
    "Goal",
    "Project",
    "Task",
    "task_dependencies",
    "EnergyProfile",
    "ScheduleBlock",
    "LearningRecord",
]
```

**Step 2: Verify all tests still pass**

```bash
pytest tests/ -v
```

Expected: all tests PASS (no regressions)

**Step 3: Commit**

```bash
git add backend/models/__init__.py
git commit -m "chore: export all models from backend/models/__init__.py for Alembic"
```

---

## Task 11: Alembic setup + initial migration

**Files:**
- Create: `alembic.ini`
- Create: `alembic/env.py` (and associated Alembic files)

**Step 1: Initialize Alembic**

```bash
alembic init alembic
```

Expected: creates `alembic/` directory with `env.py`, `script.py.mako`, `versions/`, and `alembic.ini`.

**Step 2: Edit `alembic.ini`** — set the database URL line

Find this line in `alembic.ini`:
```
sqlalchemy.url = driver://user:pass@localhost/dbname
```

Replace with:
```
sqlalchemy.url = sqlite:///eden.db
```

**Step 3: Edit `alembic/env.py`** — point at our models and Base

Find the section that looks like:
```python
# add your model's MetaData object here
# for 'autogenerate' support
# from myapp import mymodel
# target_metadata = mymodel.Base.metadata
target_metadata = None
```

Replace with:
```python
import backend.models  # noqa: F401 — registers all models with Base.metadata
from backend.db import Base

target_metadata = Base.metadata
```

**Step 4: Generate initial migration**

```bash
alembic revision --autogenerate -m "initial_schema"
```

Expected: creates `alembic/versions/<hash>_initial_schema.py`. Open it and verify it contains `CREATE TABLE` statements for all 6 tables: `goals`, `projects`, `tasks`, `task_dependencies`, `energy_profiles`, `schedule_blocks`, `learning_records`.

**Step 5: Run the migration**

```bash
alembic upgrade head
```

Expected: `Running upgrade  -> <hash>, initial_schema` with no errors. Creates `eden.db`.

**Step 6: Verify DB**

```bash
python -c "
from sqlalchemy import create_engine, inspect
engine = create_engine('sqlite:///eden.db')
print(inspect(engine).get_table_names())
"
```

Expected output includes all 7 table names (including `alembic_version`).

**Step 7: Commit**

```bash
git add alembic/ alembic.ini
git commit -m "feat: add Alembic with initial schema migration for all 6 models"
```

---

## Task 12: FastAPI DB dependency injection + full test run

**Files:**
- Modify: `backend/main.py`
- Create: `tests/test_db_dependency.py`

**Step 1: Write failing test**

```python
# tests/test_db_dependency.py
from fastapi.testclient import TestClient
from backend.main import app

client = TestClient(app)


def test_health_check_still_passes():
    response = client.get("/health")
    assert response.status_code == 200


def test_db_info_endpoint():
    response = client.get("/db-info")
    assert response.status_code == 200
    data = response.json()
    assert "tables" in data
    assert "goals" in data["tables"]
```

**Step 2: Run to verify it fails**

```bash
pytest tests/test_db_dependency.py -v
```

Expected: FAIL — `/db-info` route doesn't exist.

**Step 3: Update `backend/main.py`**

```python
from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect
from backend.db import get_db, engine
import backend.models  # noqa: F401 — ensure all models registered

app = FastAPI(title="Eden", version="0.1.0")


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
```

**Step 4: Run to verify it passes**

```bash
pytest tests/test_db_dependency.py -v
```

Expected: PASS

**Step 5: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests PASS.

**Step 6: Commit**

```bash
git add backend/main.py tests/test_db_dependency.py
git commit -m "feat: wire DB dependency injection into FastAPI, add /db-info endpoint"
```

---

## Done

At this point you have:
- Full project scaffold with `pyproject.toml`
- Settings via pydantic-settings + `.env`
- FastAPI app running with DB dependency injection
- All 6 SQLAlchemy models tested and working
- Alembic configured with the initial migration applied
- `eden.db` created and ready

Next layer: scheduler engine (`backend/scheduler/engine.py`, `constraints.py`, `decay.py`).
