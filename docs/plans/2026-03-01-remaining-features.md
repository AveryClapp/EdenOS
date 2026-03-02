# Remaining Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Energy Profile API, Availability Windows API, GitHub integration, background scheduler, Settings UI, and frontend error/status improvements to complete the EdenOS MVP.

**Architecture:** Seven independent tasks — backend API tasks first (they unblock the frontend), then the Settings view that consumes those APIs, then frontend polish. The GitHub integration adds an `external_id` column to tasks (Alembic migration required) and a read-only sync route. The background scheduler extracts a helper from the existing schedule route and runs it in a FastAPI lifespan loop.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic v2 (backend), React + TanStack Query + Tailwind v4 (frontend), httpx (GitHub HTTP client), asyncio (background loop), Alembic (migrations)

---

## Context

**Working directory:** `/Users/averyclapp/Documents/Coding/GitProjects/EdenOS`

**Run all tests with:** `python -m pytest tests/ -v` from the repo root (ensure `PYTHONPATH=.`)

**Current test count:** 102 passing

**Key patterns to follow:**
- Route handlers return ORM objects directly; Pydantic schemas have `model_config = {"from_attributes": True}`
- Test client fixture in `tests/api/conftest.py` uses `StaticPool` in-memory SQLite — model changes are picked up automatically via `Base.metadata.create_all(engine)` in `tests/conftest.py`
- No module-level singletons that make external API calls — use FastAPI `Depends()` for lazy instantiation
- Alembic migration files live in `alembic/versions/`; current head revision is `ecf4a26ec98d`

---

## Task 1: `.env.example`

**Files:**
- Create: `.env.example`

**Step 1: Create the file**

```
DATABASE_URL=sqlite:///eden.db
SCHEDULER_INTERVAL_SECONDS=1800
SYNC_INTERVAL_SECONDS=600
LLM_MODEL=claude-opus-4-6
SECRET_KEY=change-me-in-production

ANTHROPIC_API_KEY=

GITHUB_TOKEN=

GCAL_CLIENT_ID=
GCAL_CLIENT_SECRET=
GCAL_REDIRECT_URI=

MS_CLIENT_ID=
MS_CLIENT_SECRET=
MS_TENANT_ID=
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "chore: add .env.example"
```

---

## Task 2: Energy Profile API

**Files:**
- Modify: `backend/api/schemas.py` (append schemas)
- Create: `backend/api/energy_profile.py`
- Modify: `backend/main.py` (register router)
- Create: `tests/api/test_energy_profile.py`

**Step 1: Write failing tests**

Create `tests/api/test_energy_profile.py`:

```python
import pytest


def test_get_empty(client):
    r = client.get("/api/energy-profile")
    assert r.status_code == 200
    assert r.json() == []


def test_put_and_get(client):
    body = {
        "entries": [
            {"hour_of_day": 9, "day_of_week": 0, "energy_level": 4},
            {"hour_of_day": 10, "day_of_week": 0, "energy_level": 5},
        ]
    }
    r = client.put("/api/energy-profile", json=body)
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 2
    assert all("id" in e for e in data)

    r = client.get("/api/energy-profile")
    assert len(r.json()) == 2


def test_put_replaces_all(client):
    client.put("/api/energy-profile", json={"entries": [
        {"hour_of_day": 9, "day_of_week": 0, "energy_level": 3}
    ]})
    r = client.put("/api/energy-profile", json={"entries": [
        {"hour_of_day": 8, "day_of_week": 1, "energy_level": 2},
        {"hour_of_day": 9, "day_of_week": 1, "energy_level": 4},
    ]})
    assert len(r.json()) == 2
    r = client.get("/api/energy-profile")
    assert len(r.json()) == 2


def test_put_empty_clears(client):
    client.put("/api/energy-profile", json={"entries": [
        {"hour_of_day": 9, "day_of_week": 0, "energy_level": 3}
    ]})
    r = client.put("/api/energy-profile", json={"entries": []})
    assert r.status_code == 200
    assert r.json() == []
```

**Step 2: Run to verify failure**

```bash
python -m pytest tests/api/test_energy_profile.py -v
```

Expected: FAIL with `404` or module import error.

**Step 3: Add schemas to `backend/api/schemas.py`**

Append after the `# --- Chat ---` block:

```python
# --- Energy Profile ---

class EnergyProfileEntry(BaseModel):
    hour_of_day: int   # 0–23
    day_of_week: int   # 0=Mon, 6=Sun
    energy_level: int  # 1–5
    is_post_hard_workout: bool = False
    notes: str | None = None


class EnergyProfileBulkSet(BaseModel):
    entries: list[EnergyProfileEntry]


class EnergyProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    hour_of_day: int
    day_of_week: int
    energy_level: int
    is_post_hard_workout: bool
    notes: str | None
```

**Step 4: Create `backend/api/energy_profile.py`**

```python
import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.energy_profile import EnergyProfile
from backend.api.schemas import EnergyProfileBulkSet, EnergyProfileResponse

router = APIRouter(prefix="/api/energy-profile", tags=["energy-profile"])


@router.get("", response_model=list[EnergyProfileResponse])
def get_energy_profile(db: Session = Depends(get_db)):
    return db.query(EnergyProfile).all()


@router.put("", response_model=list[EnergyProfileResponse])
def set_energy_profile(body: EnergyProfileBulkSet, db: Session = Depends(get_db)):
    db.query(EnergyProfile).delete()
    entries = [
        EnergyProfile(
            id=str(uuid.uuid4()),
            hour_of_day=e.hour_of_day,
            day_of_week=e.day_of_week,
            energy_level=e.energy_level,
            is_post_hard_workout=e.is_post_hard_workout,
            notes=e.notes,
        )
        for e in body.entries
    ]
    db.add_all(entries)
    db.commit()
    for e in entries:
        db.refresh(e)
    return entries
```

**Step 5: Register router in `backend/main.py`**

Add import after the existing router imports:
```python
from backend.api.energy_profile import router as energy_profile_router
```

Add after `app.include_router(chat_router)`:
```python
app.include_router(energy_profile_router)
```

**Step 6: Run tests to verify passing**

```bash
python -m pytest tests/api/test_energy_profile.py -v
```

Expected: 4 PASS

**Step 7: Run full suite**

```bash
python -m pytest tests/ -v
```

Expected: 106 PASS (102 + 4 new)

**Step 8: Commit**

```bash
git add backend/api/energy_profile.py backend/api/schemas.py backend/main.py tests/api/test_energy_profile.py
git commit -m "feat: add energy profile API (GET/PUT /api/energy-profile)"
```

---

## Task 3: Availability Windows API

**Files:**
- Modify: `backend/api/schemas.py` (append schemas)
- Create: `backend/api/availability.py`
- Modify: `backend/main.py` (register router)
- Create: `tests/api/test_availability.py`

**Step 1: Write failing tests**

Create `tests/api/test_availability.py`:

```python
import pytest


def test_list_empty(client):
    r = client.get("/api/availability")
    assert r.status_code == 200
    assert r.json() == []


def test_create_and_list(client):
    body = {"day_of_week": 0, "start_time": "09:00", "end_time": "17:00"}
    r = client.post("/api/availability", json=body)
    assert r.status_code == 201
    data = r.json()
    assert data["day_of_week"] == 0
    assert data["is_available"] is True
    assert "09:00" in data["start_time"]

    r = client.get("/api/availability")
    assert len(r.json()) == 1


def test_create_every_day(client):
    """day_of_week=None means applies to every day."""
    r = client.post("/api/availability", json={"start_time": "08:00", "end_time": "20:00"})
    assert r.status_code == 201
    assert r.json()["day_of_week"] is None


def test_update(client):
    r = client.post("/api/availability", json={"start_time": "09:00", "end_time": "17:00"})
    wid = r.json()["id"]
    r = client.patch(f"/api/availability/{wid}", json={"end_time": "18:00"})
    assert r.status_code == 200
    assert "18:00" in r.json()["end_time"]


def test_delete(client):
    r = client.post("/api/availability", json={"start_time": "09:00", "end_time": "17:00"})
    wid = r.json()["id"]
    r = client.delete(f"/api/availability/{wid}")
    assert r.status_code == 204
    r = client.get("/api/availability")
    assert r.json() == []


def test_404_patch(client):
    r = client.patch("/api/availability/nonexistent", json={"end_time": "18:00"})
    assert r.status_code == 404


def test_404_delete(client):
    r = client.delete("/api/availability/nonexistent")
    assert r.status_code == 404
```

**Step 2: Run to verify failure**

```bash
python -m pytest tests/api/test_availability.py -v
```

Expected: FAIL (routes don't exist yet)

**Step 3: Add schemas to `backend/api/schemas.py`**

Append after the `# --- Energy Profile ---` block:

```python
# --- Availability Windows ---

class AvailabilityCreate(BaseModel):
    day_of_week: int | None = None   # None = every day; 0=Mon–6=Sun
    start_time: str                  # "HH:MM"
    end_time: str                    # "HH:MM"
    is_available: bool = True
    note: str | None = None


class AvailabilityUpdate(BaseModel):
    day_of_week: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    is_available: bool | None = None
    note: str | None = None


class AvailabilityResponse(BaseModel):
    from datetime import time as Time
    model_config = {"from_attributes": True}

    id: str
    day_of_week: int | None
    start_time: Time
    end_time: Time
    is_available: bool
    note: str | None
```

**Step 4: Create `backend/api/availability.py`**

```python
import uuid
from datetime import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.availability_window import AvailabilityWindow
from backend.api.schemas import AvailabilityCreate, AvailabilityUpdate, AvailabilityResponse

router = APIRouter(prefix="/api/availability", tags=["availability"])


def _parse_time(s: str) -> time:
    h, m = s.split(":")[:2]
    return time(int(h), int(m))


@router.get("", response_model=list[AvailabilityResponse])
def list_availability(db: Session = Depends(get_db)):
    return db.query(AvailabilityWindow).all()


@router.post("", response_model=AvailabilityResponse, status_code=201)
def create_availability(body: AvailabilityCreate, db: Session = Depends(get_db)):
    window = AvailabilityWindow(
        id=str(uuid.uuid4()),
        day_of_week=body.day_of_week,
        start_time=_parse_time(body.start_time),
        end_time=_parse_time(body.end_time),
        is_available=body.is_available,
        note=body.note,
    )
    db.add(window)
    db.commit()
    db.refresh(window)
    return window


@router.patch("/{window_id}", response_model=AvailabilityResponse)
def update_availability(window_id: str, body: AvailabilityUpdate, db: Session = Depends(get_db)):
    window = db.query(AvailabilityWindow).filter(AvailabilityWindow.id == window_id).first()
    if not window:
        raise HTTPException(status_code=404, detail="Availability window not found")
    data = body.model_dump(exclude_none=True)
    if "start_time" in data:
        data["start_time"] = _parse_time(data["start_time"])
    if "end_time" in data:
        data["end_time"] = _parse_time(data["end_time"])
    for field, value in data.items():
        setattr(window, field, value)
    db.commit()
    db.refresh(window)
    return window


@router.delete("/{window_id}", status_code=204)
def delete_availability(window_id: str, db: Session = Depends(get_db)):
    window = db.query(AvailabilityWindow).filter(AvailabilityWindow.id == window_id).first()
    if not window:
        raise HTTPException(status_code=404, detail="Availability window not found")
    db.delete(window)
    db.commit()
```

**Step 5: Register router in `backend/main.py`**

Add import:
```python
from backend.api.availability import router as availability_router
```

Add after `app.include_router(energy_profile_router)`:
```python
app.include_router(availability_router)
```

**Step 6: Fix `apiFetch` for 204 No Content responses**

The `DELETE` endpoint returns 204 with no body. `res.json()` will fail on an empty body.

Open `frontend/src/api/client.ts` and replace it with:

```typescript
const BASE = '/api'

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`${res.status}: ${text}`)
  }
  if (res.status === 204 || res.headers.get('content-length') === '0') {
    return undefined as T
  }
  return res.json() as Promise<T>
}
```

**Step 7: Run tests to verify passing**

```bash
python -m pytest tests/api/test_availability.py -v
```

Expected: 7 PASS

**Step 8: Run full suite**

```bash
python -m pytest tests/ -v
```

Expected: 113 PASS (106 + 7 new)

**Step 9: Commit**

```bash
git add backend/api/availability.py backend/api/schemas.py backend/main.py tests/api/test_availability.py frontend/src/api/client.ts
git commit -m "feat: add availability windows API and fix apiFetch for 204 responses"
```

---

## Task 4: Task `external_id` + GitHub Integration

**Files:**
- Modify: `backend/models/task.py` (add `external_id` column)
- Run: `alembic revision --autogenerate -m "add_task_external_id"` (generates migration file)
- Modify: `backend/config.py` (add `github_token`)
- Create: `backend/integrations/github.py`
- Create: `backend/api/github.py`
- Modify: `backend/main.py` (register router)
- Create: `tests/api/test_github.py`

**Step 1: Write failing tests**

Create `tests/api/test_github.py`:

```python
from unittest.mock import patch, MagicMock
from datetime import date

import pytest


FAKE_ISSUE = {
    "id": 111111,
    "title": "Fix login bug",
    "body": "Login fails for OAuth users.",
    "html_url": "https://github.com/owner/repo/issues/1",
}

FAKE_PR = {
    "id": 222222,
    "title": "Add dark mode",
    "body": "Implements dark mode toggle.",
    "html_url": "https://github.com/owner/repo/pull/2",
    "pull_request": {"url": "https://api.github.com/..."},
}


def _make_project(db):
    from backend.models.goal import Goal
    from backend.models.project import Project

    goal = Goal(
        id="g1", title="Test Goal", tier="long", status="active",
        weight=1.0, target_date=date(2027, 1, 1),
    )
    project = Project(
        id="p1", title="Test Project", category="engineering",
        goal_id="g1", status="active", priority_score=0.5,
        estimated_hours_remaining=10.0,
    )
    db.add_all([goal, project])
    db.commit()
    return project


def _patched_sync(client, project_id="p1", issues=None, prs=None):
    """Helper: run sync with mocked GitHub client and token."""
    mock_gh = MagicMock()
    mock_gh.get_assigned_issues.return_value = issues or []
    mock_gh.get_review_requested_prs.return_value = prs or []
    with patch("backend.api.github.settings") as mock_settings, \
         patch("backend.api.github.GitHubClient", return_value=mock_gh):
        mock_settings.github_token = "fake-token"
        return client.post(f"/api/github/sync?project_id={project_id}")


def test_sync_no_token(client):
    r = client.post("/api/github/sync?project_id=p1")
    assert r.status_code == 400


def test_sync_imports_issues_and_prs(client, db):
    _make_project(db)
    r = _patched_sync(client, issues=[FAKE_ISSUE], prs=[FAKE_PR])
    assert r.status_code == 200
    assert r.json() == {"imported": 2, "skipped": 0}


def test_sync_deduplicates(client, db):
    _make_project(db)
    r = _patched_sync(client, issues=[FAKE_ISSUE])
    assert r.json()["imported"] == 1
    # Second sync — same issue already imported
    r = _patched_sync(client, issues=[FAKE_ISSUE])
    assert r.json()["imported"] == 0
    assert r.json()["skipped"] == 1


def test_sync_no_project_id(client):
    r = client.post("/api/github/sync")
    assert r.status_code == 422  # missing required query param


def test_sync_tasks_have_github_source(client, db):
    _make_project(db)
    _patched_sync(client, issues=[FAKE_ISSUE])
    from backend.models.task import Task
    tasks = db.query(Task).all()
    assert len(tasks) == 1
    assert tasks[0].source == "github"
    assert tasks[0].external_id == str(FAKE_ISSUE["id"])
```

**Step 2: Run to verify failure**

```bash
python -m pytest tests/api/test_github.py -v
```

Expected: FAIL (module not found)

**Step 3: Add `external_id` to Task model**

Open `backend/models/task.py`. After the `source` mapped column (around line 38), add:

```python
external_id: Mapped[str | None] = mapped_column(String(500), nullable=True)
```

**Step 4: Generate Alembic migration**

```bash
alembic revision --autogenerate -m "add_task_external_id"
```

This creates a new file in `alembic/versions/`. Open it and verify the `upgrade()` function contains:

```python
op.add_column('tasks', sa.Column('external_id', sa.String(length=500), nullable=True))
```

And `downgrade()` contains:

```python
op.drop_column('tasks', 'external_id')
```

If the auto-generated file looks correct, apply it:

```bash
alembic upgrade head
```

Expected output: `Running upgrade ecf4a26ec98d -> <new_rev>, add_task_external_id`

**Step 5: Add `github_token` to `backend/config.py`**

Add after `github_client_secret`:

```python
github_token: str = ""
```

**Step 6: Create `backend/integrations/github.py`**

```python
from typing import Any

import httpx

GITHUB_API = "https://api.github.com"


class GitHubClient:
    def __init__(self, token: str) -> None:
        self._headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json",
        }

    def get_assigned_issues(self) -> list[dict[str, Any]]:
        """Return open issues assigned to the authenticated user (excludes PRs)."""
        resp = httpx.get(
            f"{GITHUB_API}/issues",
            params={"filter": "assigned", "state": "open"},
            headers=self._headers,
        )
        resp.raise_for_status()
        # GitHub /issues endpoint may include PRs — filter them out
        return [item for item in resp.json() if "pull_request" not in item]

    def get_review_requested_prs(self) -> list[dict[str, Any]]:
        """Return open PRs where review is requested from the authenticated user."""
        resp = httpx.get(
            f"{GITHUB_API}/search/issues",
            params={"q": "is:open is:pr review-requested:@me"},
            headers=self._headers,
        )
        resp.raise_for_status()
        return resp.json().get("items", [])
```

**Step 7: Create `backend/api/github.py`**

```python
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.config import settings
from backend.integrations.github import GitHubClient
from backend.models.task import Task

router = APIRouter(prefix="/api/github", tags=["github"])


@router.post("/sync")
def sync_github(
    project_id: str = Query(..., description="Project ID to import tasks into"),
    db: Session = Depends(get_db),
):
    if not settings.github_token:
        raise HTTPException(status_code=400, detail="GITHUB_TOKEN not configured")

    client = GitHubClient(settings.github_token)

    try:
        items: list[dict] = []
        items += client.get_assigned_issues()
        items += client.get_review_requested_prs()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"GitHub API error: {e}")

    imported = 0
    skipped = 0
    seen: set[str] = set()

    for item in items:
        external_id = str(item["id"])
        if external_id in seen:
            continue
        seen.add(external_id)

        existing = db.query(Task).filter(Task.external_id == external_id).first()
        if existing:
            skipped += 1
            continue

        task = Task(
            id=str(uuid.uuid4()),
            project_id=project_id,
            title=item["title"],
            description=item.get("body") or None,
            cognitive_load=2,
            estimated_minutes=60,
            source="github",
            status="backlog",
            external_id=external_id,
            created_at=datetime.utcnow(),
        )
        db.add(task)
        imported += 1

    db.commit()
    return {"imported": imported, "skipped": skipped}
```

**Step 8: Register router in `backend/main.py`**

Add import:
```python
from backend.api.github import router as github_router
```

Add:
```python
app.include_router(github_router)
```

**Step 9: Run tests to verify passing**

```bash
python -m pytest tests/api/test_github.py -v
```

Expected: 5 PASS

**Step 10: Run full suite**

```bash
python -m pytest tests/ -v
```

Expected: 118 PASS (113 + 5 new)

**Step 11: Commit**

```bash
git add backend/models/task.py alembic/versions/ backend/config.py backend/integrations/github.py backend/api/github.py backend/main.py tests/api/test_github.py
git commit -m "feat: add GitHub read-only sync (import issues/PRs as tasks)"
```

---

## Task 5: Background Scheduler Job

**Files:**
- Modify: `backend/api/schedule.py` (extract helper function)
- Modify: `backend/main.py` (add lifespan + background loop)

**Step 1: Extract helper in `backend/api/schedule.py`**

Currently `run_scheduler` contains all the logic inline. Extract it into a module-level helper so the background loop can reuse it without going through the HTTP route.

Replace the current `run_scheduler` function (lines ~47–94) with:

```python
def _run_scheduler_job(db: Session) -> ScheduleRunResponse:
    """Core scheduler logic — callable from both the route and the background loop."""
    now = datetime.utcnow()
    start_date = date.today()

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

    deleted = db.query(ScheduleBlock).filter(
        ScheduleBlock.auto_generated == True,
        ScheduleBlock.overridden_by_user == False,
    ).delete(synchronize_session=False)
    db.flush()

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


@router.post("/run", response_model=ScheduleRunResponse)
def run_scheduler(db: Session = Depends(get_db)):
    return _run_scheduler_job(db)
```

**Step 2: Run existing tests to confirm no regression**

```bash
python -m pytest tests/api/test_schedule.py -v
```

Expected: all PASS (same count as before)

**Step 3: Update `backend/main.py`**

Replace the entire file with:

```python
import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Depends
from sqlalchemy.orm import Session
from sqlalchemy import inspect as sa_inspect

from backend.db import get_db, engine, SessionLocal
import backend.models  # noqa: F401 — ensure all models registered

from backend.api.goals import router as goals_router
from backend.api.projects import router as projects_router
from backend.api.tasks import router as tasks_router
from backend.api.schedule import router as schedule_router, _run_scheduler_job
from backend.api.chat import router as chat_router
from backend.api.energy_profile import router as energy_profile_router
from backend.api.availability import router as availability_router
from backend.api.github import router as github_router
from backend.config import settings


async def _scheduler_loop() -> None:
    """Background task: re-run the scheduler every SCHEDULER_INTERVAL_SECONDS."""
    while True:
        await asyncio.sleep(settings.scheduler_interval_seconds)
        db = SessionLocal()
        try:
            _run_scheduler_job(db)
        except Exception as exc:
            print(f"[scheduler] background run failed: {exc}")
        finally:
            db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    task = asyncio.create_task(_scheduler_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="Eden", version="0.1.0", lifespan=lifespan)

app.include_router(goals_router)
app.include_router(projects_router)
app.include_router(tasks_router)
app.include_router(schedule_router)
app.include_router(chat_router)
app.include_router(energy_profile_router)
app.include_router(availability_router)
app.include_router(github_router)


@app.get("/health")
def health_check():
    return {"status": "ok"}


@app.get("/db-info")
def db_info(db: Session = Depends(get_db)):
    tables = sa_inspect(engine).get_table_names()
    return {"tables": tables}
```

**Note:** The test `TestClient` does NOT trigger the lifespan loop (it's only triggered when used as a context manager via `with TestClient(app)`). The existing test fixture uses `yield TestClient(app)` without context manager, so the background loop never starts during tests — this is intentional.

**Step 4: Run full test suite to confirm no regression**

```bash
python -m pytest tests/ -v
```

Expected: 118 PASS (same as before — no new tests needed for the background loop itself)

**Step 5: Commit**

```bash
git add backend/api/schedule.py backend/main.py
git commit -m "feat: add background scheduler loop (runs every 30min via FastAPI lifespan)"
```

---

## Task 6: Settings Frontend (Energy Profile + Availability + GitHub Sync)

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/api/energy_profile.ts`
- Create: `frontend/src/api/availability.ts`
- Create: `frontend/src/api/github.ts`
- Create: `frontend/src/views/Settings.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`

**Step 1: Add types to `frontend/src/types.ts`**

Append:

```typescript
export interface EnergyProfileEntry {
  id: string
  hour_of_day: number
  day_of_week: number
  energy_level: number
  is_post_hard_workout: boolean
  notes: string | null
}

export interface AvailabilityWindow {
  id: string
  day_of_week: number | null
  start_time: string   // "HH:MM:SS" from FastAPI
  end_time: string
  is_available: boolean
  note: string | null
}
```

**Step 2: Create `frontend/src/api/energy_profile.ts`**

```typescript
import { apiFetch } from './client'
import type { EnergyProfileEntry } from '../types'

export const getEnergyProfile = () =>
  apiFetch<EnergyProfileEntry[]>('/energy-profile')

export const setEnergyProfile = (
  entries: Array<{
    hour_of_day: number
    day_of_week: number
    energy_level: number
    is_post_hard_workout?: boolean
    notes?: string | null
  }>,
) =>
  apiFetch<EnergyProfileEntry[]>('/energy-profile', {
    method: 'PUT',
    body: JSON.stringify({ entries }),
  })
```

**Step 3: Create `frontend/src/api/availability.ts`**

```typescript
import { apiFetch } from './client'
import type { AvailabilityWindow } from '../types'

export const listAvailability = () =>
  apiFetch<AvailabilityWindow[]>('/availability')

export const createAvailability = (body: {
  day_of_week?: number | null
  start_time: string
  end_time: string
  is_available?: boolean
  note?: string | null
}) =>
  apiFetch<AvailabilityWindow>('/availability', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteAvailability = (id: string) =>
  apiFetch<void>(`/availability/${id}`, { method: 'DELETE' })
```

**Step 4: Create `frontend/src/api/github.ts`**

```typescript
import { apiFetch } from './client'

export const syncGitHub = (projectId: string) =>
  apiFetch<{ imported: number; skipped: number }>(
    `/github/sync?project_id=${projectId}`,
    { method: 'POST' },
  )
```

**Step 5: Create `frontend/src/views/Settings.tsx`**

```tsx
import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEnergyProfile, setEnergyProfile } from '../api/energy_profile'
import { listAvailability, createAvailability, deleteAvailability } from '../api/availability'
import { syncGitHub } from '../api/github'
import { listProjects } from '../api/projects'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const ENERGY_COLORS = [
  '',
  'text-red-500',
  'text-orange-400',
  'text-yellow-400',
  'text-lime-400',
  'text-emerald-400',
]

// ─── Energy Profile ───────────────────────────────────────────────────────────

function EnergyGrid() {
  const qc = useQueryClient()
  const { data: profile = [] } = useQuery({
    queryKey: ['energy-profile'],
    queryFn: getEnergyProfile,
  })

  const [grid, setGrid] = useState<number[][]>(() =>
    Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 3)),
  )

  useEffect(() => {
    if (profile.length === 0) return
    const next = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 3))
    profile.forEach((e) => {
      next[e.day_of_week][e.hour_of_day] = e.energy_level
    })
    setGrid(next)
  }, [profile])

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => {
      const entries = []
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          entries.push({ day_of_week: d, hour_of_day: h, energy_level: grid[d][h] })
        }
      }
      return setEnergyProfile(entries)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['energy-profile'] }),
  })

  function cycleCell(day: number, hour: number) {
    setGrid((prev) =>
      prev.map((row, d) =>
        d === day ? row.map((val, h) => (h === hour ? (val % 5) + 1 : val)) : row,
      ),
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-zinc-600 text-xs">Click cells to cycle 1–5 (1=low, 5=high energy)</span>
        <button
          onClick={() => save()}
          disabled={isPending}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
        >
          {isPending ? '...' : '[ save ]'}
        </button>
      </div>
      {/* Column headers */}
      <div className="flex text-xs text-zinc-600 mb-0.5">
        <span className="w-8" />
        {DAYS.map((d) => (
          <span key={d} className="w-8 text-center">{d}</span>
        ))}
      </div>
      {/* Hour rows */}
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="flex items-center">
          <span className="text-zinc-700 text-xs w-8 shrink-0">
            {String(h).padStart(2, '0')}
          </span>
          {Array.from({ length: 7 }, (_, d) => (
            <button
              key={d}
              onClick={() => cycleCell(d, h)}
              className={`w-8 h-5 text-xs font-mono hover:bg-zinc-800 transition-colors ${ENERGY_COLORS[grid[d][h]]}`}
            >
              {grid[d][h]}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Availability Windows ─────────────────────────────────────────────────────

function AvailabilitySection() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [day, setDay] = useState<string>('')   // '' = every day

  const { data: windows = [] } = useQuery({
    queryKey: ['availability'],
    queryFn: listAvailability,
  })

  const { mutate: add, isPending: addPending } = useMutation({
    mutationFn: () =>
      createAvailability({
        day_of_week: day === '' ? null : Number(day),
        start_time: start,
        end_time: end,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['availability'] })
      setAdding(false)
    },
  })

  const { mutate: del } = useMutation({
    mutationFn: deleteAvailability,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['availability'] }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-zinc-600 text-xs">If none configured, defaults to 06:00–22:00 every day.</span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          + add
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2 text-xs mb-2 py-2 border-b border-zinc-800">
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          >
            <option value="">every day</option>
            {DAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          />
          <span className="text-zinc-600">–</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          />
          <button
            onClick={() => add()}
            disabled={addPending}
            className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
          >
            {addPending ? '...' : '[ add ]'}
          </button>
          <button onClick={() => setAdding(false)} className="text-zinc-600 hover:text-zinc-400 transition-colors">
            cancel
          </button>
        </div>
      )}

      {windows.length === 0 && !adding ? (
        <div className="text-zinc-700 text-xs py-2">no windows defined</div>
      ) : (
        windows.map((w) => (
          <div key={w.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-zinc-900">
            <span className="text-zinc-500 w-12 shrink-0">
              {w.day_of_week !== null ? DAYS[w.day_of_week] : 'ALL'}
            </span>
            <span className="text-zinc-200">
              {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}
            </span>
            <span className={w.is_available ? 'text-emerald-600' : 'text-zinc-600'}>
              {w.is_available ? 'available' : 'blocked'}
            </span>
            {w.note && <span className="text-zinc-600 italic flex-1">{w.note}</span>}
            <button
              onClick={() => del(w.id)}
              className="text-zinc-700 hover:text-red-500 ml-auto transition-colors"
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  )
}

// ─── GitHub Sync ──────────────────────────────────────────────────────────────

function GitHubSection() {
  const qc = useQueryClient()
  const [projectId, setProjectId] = useState('')
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  })

  const { mutate: sync, isPending } = useMutation({
    mutationFn: () => syncGitHub(projectId),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  const activeProjects = projects.filter((p) => p.status === 'active')

  return (
    <div>
      <p className="text-zinc-600 text-xs mb-2">
        Imports open issues assigned to you + PRs requesting your review. Set{' '}
        <code className="text-zinc-400">GITHUB_TOKEN</code> in your <code className="text-zinc-400">.env</code>.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs flex-1"
        >
          <option value="">select project to import into...</option>
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <button
          onClick={() => sync()}
          disabled={isPending || !projectId}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 border border-zinc-700 disabled:border-zinc-800 px-2 py-1 transition-colors"
        >
          {isPending ? 'syncing...' : '[ sync ]'}
        </button>
      </div>
      {result && (
        <p className="text-zinc-500 text-xs mt-1.5">
          {result.imported} imported, {result.skipped} already present
        </p>
      )}
    </div>
  )
}

// ─── Settings View ────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-zinc-800 text-sm tracking-widest text-zinc-100 shrink-0">
        SETTINGS
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-10">
        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Energy Profile
          </h2>
          <EnergyGrid />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Availability
          </h2>
          <AvailabilitySection />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Integrations
          </h2>
          <GitHubSection />
        </section>
      </div>
    </div>
  )
}
```

**Step 6: Update `frontend/src/App.tsx`**

Add import:
```tsx
import Settings from './views/Settings'
```

Add route inside `<Routes>` (before the catch-all `*`):
```tsx
<Route path="/settings" element={<Settings />} />
```

**Step 7: Update `frontend/src/components/Sidebar.tsx`**

Add `{ label: '⚙', title: 'SETTINGS', path: '/settings' }` to the `NAV` array (after the Chat entry):

```typescript
const NAV = [
  { label: 'T', title: 'TODAY', path: '/' },
  { label: 'W', title: 'WEEK', path: '/week' },
  { label: 'G', title: 'GOALS', path: '/goals' },
  { label: 'P', title: 'PROJECTS', path: '/projects' },
  { label: '›', title: 'CHAT', path: '/chat' },
  { label: '⚙', title: 'SETTINGS', path: '/settings' },
]
```

**Step 8: Build to verify no TypeScript errors**

```bash
cd frontend && npm run build
```

Expected: zero errors, similar bundle size

**Step 9: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/energy_profile.ts frontend/src/api/availability.ts frontend/src/api/github.ts frontend/src/views/Settings.tsx frontend/src/App.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: add Settings view (energy profile, availability windows, GitHub sync)"
```

---

## Task 7: Frontend Error Feedback + Task Status Management

**Files:**
- Modify: `frontend/src/views/Goals.tsx`
- Modify: `frontend/src/views/Projects.tsx`
- Modify: `frontend/src/views/Today.tsx`

**Goal:** When API calls fail, show an inline `[error: ...]` message instead of silently doing nothing. Add status cycling to `TaskRow` so users can advance tasks through the workflow.

**Step 1: Error feedback in `frontend/src/views/Goals.tsx`**

In `AddGoalForm`, add `onError` state and display it. The mutation already throws on API failure (via `apiFetch`).

Find the `AddGoalForm` function. Add error state and `onError` handler to the `useMutation` call:

```tsx
const [error, setError] = useState<string | null>(null)

const { mutate, isPending } = useMutation({
  mutationFn: () =>
    createGoal({ title, tier, target_date: targetDate, weight: Number(weight) }),
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['goals'] })
    onDone()
  },
  onError: (e: Error) => setError(e.message),
})
```

Add below the cancel button inside the form div:
```tsx
{error && <span className="text-red-500 text-xs">[error: {error}]</span>}
```

**Step 2: Error feedback in `frontend/src/views/Projects.tsx`**

Apply the same pattern to both `AddTaskForm` and `AddProjectForm`:

In `AddTaskForm`:
```tsx
const [error, setError] = useState<string | null>(null)

const { mutate, isPending } = useMutation({
  mutationFn: () => createTask({ ... }),  // existing call
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['tasks'] })
    onDone()
  },
  onError: (e: Error) => setError(e.message),
})
```

Add after the cancel button:
```tsx
{error && <span className="text-red-500 text-xs">[{error}]</span>}
```

In `AddProjectForm`, same pattern.

**Step 3: Task status cycling in `frontend/src/views/Projects.tsx`**

The `TaskRow` component currently only displays status. Add a cycle button so users can advance task status without the completion form.

Status cycle order: `backlog → active → in_progress → deferred → backlog`
(Completing a task via the Today view remains the primary way to mark `done`.)

Replace the `TaskRow` component with:

```tsx
const STATUS_NEXT: Record<string, string> = {
  backlog: 'active',
  active: 'in_progress',
  in_progress: 'deferred',
  deferred: 'backlog',
  done: 'backlog',
}

function TaskRow({ task }: { task: Task }) {
  const qc = useQueryClient()

  const { mutate: advance } = useMutation({
    mutationFn: (status: string) => updateTask(task.id, { status: status as Task['status'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs border-b border-zinc-900 hover:bg-zinc-900 transition-colors group">
      <button
        className={`w-16 shrink-0 text-left ${TASK_STATUS_COLORS[task.status]} hover:opacity-70 transition-opacity`}
        onClick={() => advance(STATUS_NEXT[task.status])}
        title="Click to advance status"
        disabled={task.status === 'done'}
      >
        {task.status}
      </button>
      <span
        className={`flex-1 ${task.status === 'done' ? 'line-through text-zinc-600' : 'text-zinc-200'}`}
      >
        {task.title}
      </span>
      <LoadDots level={task.cognitive_load} />
      <span className="text-zinc-600 w-14 text-right shrink-0">{task.estimated_minutes}m</span>
      {task.deadline && (
        <span className="text-amber-600 shrink-0">{task.deadline.slice(0, 10)}</span>
      )}
    </div>
  )
}
```

Add the `updateTask` import if not already present:
```tsx
import { listTasks, createTask, updateTask } from '../api/tasks'
```

**Step 4: Error feedback in `frontend/src/views/Today.tsx`**

In `CompleteForm`, add `onError`:

```tsx
const [error, setError] = useState<string | null>(null)

const { mutate, isPending } = useMutation({
  mutationFn: () => completeTask(task.id, { ... }),  // existing call
  onSuccess: () => {
    qc.invalidateQueries({ queryKey: ['schedule'] })
    qc.invalidateQueries({ queryKey: ['tasks'] })
    onDone()
  },
  onError: (e: Error) => setError(e.message),
})
```

Add after the cancel button:
```tsx
{error && <span className="text-red-500 text-xs ml-2">[{error}]</span>}
```

**Step 5: Build to verify no TypeScript errors**

```bash
cd frontend && npm run build
```

Expected: zero errors

**Step 6: Commit**

```bash
git add frontend/src/views/Goals.tsx frontend/src/views/Projects.tsx frontend/src/views/Today.tsx
git commit -m "feat: add error feedback to forms and task status cycling in Projects"
```

---

## Done

After all 7 tasks:

- Run `python -m pytest tests/ -v` — expect 118+ passing
- Run `cd frontend && npm run build` — expect zero errors
- Start the backend: `uvicorn backend.main:app --reload`
- Start the frontend: `cd frontend && npm run dev`
- Navigate to `http://localhost:5173/settings` to verify the new Settings view
