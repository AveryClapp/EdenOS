# Scheduler Engine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the EdenOS scheduling engine — temporal decay urgency model, availability-aware slot grid, and OR-Tools CP-SAT solver that produces a 7-day schedule honoring all hard constraints and optimizing for urgency × energy fit.

**Architecture:** Three modules: `decay.py` (pure urgency math, all constants configurable), `constraints.py` (slot grid, blocked/recovery/energy helpers), `engine.py` (CP-SAT solver — deterministic, no DB dependency, tasks split into 30-min units). Engine input/output are plain Python objects; the caller handles DB persistence. A new `AvailabilityWindow` model captures when the user is free; calendar blocks carve out the rest.

**Tech Stack:** Python, google-ortools (CP-SAT solver), existing SQLAlchemy models, Alembic, pytest

---

## Task 1: Add OR-Tools + test scaffold

**Files:**
- Modify: `pyproject.toml`
- Create: `tests/scheduler/__init__.py`

**Step 1: Add ortools to dependencies**

Edit `pyproject.toml` — add to the `dependencies` list:
```toml
"ortools>=9.4.0",
```

**Step 2: Sync**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv sync --extra dev
```

Expected: installs without errors. Verify with:
```bash
uv run python -c "from ortools.sat.python import cp_model; print('ok')"
```
Expected output: `ok`

**Step 3: Create test directory**

```bash
touch tests/scheduler/__init__.py
```

**Step 4: Commit**

```bash
git add pyproject.toml uv.lock tests/scheduler/__init__.py
git commit -m "feat: add ortools dependency and scheduler test directory"
```

---

## Task 2: backend/scheduler/decay.py

**Files:**
- Create: `backend/scheduler/decay.py`
- Create: `tests/scheduler/test_decay.py`

**Step 1: Write failing tests**

```python
# tests/scheduler/test_decay.py
import math
from datetime import datetime, timedelta
from backend.scheduler.decay import compute_urgency, K_STEEPNESS


def _dates(days_total, days_remaining):
    now = datetime(2026, 3, 1, 12, 0, 0)
    created_at = now - timedelta(days=days_total - days_remaining)
    deadline = now + timedelta(days=days_remaining)
    return created_at, deadline, now


def test_urgency_at_t0():
    """At creation (full time remaining), urgency ≈ base_priority."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=10)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS * (1 - 10/10))
    assert abs(result - expected) < 1e-9


def test_urgency_at_t_half():
    """At midpoint, urgency = base * e^(k * 0.5)."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=5)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS * 0.5)
    assert abs(result - expected) < 1e-9


def test_urgency_at_t_ninety_percent():
    """At 90% through the window, urgency = base * e^(k * 0.9)."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=1)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS * 0.9)
    assert abs(result - expected) < 1e-9


def test_urgency_past_deadline():
    """Past deadline: urgency is capped at base * e^k."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=-2)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS)
    assert abs(result - expected) < 1e-9


def test_urgency_no_deadline():
    """No deadline: returns base_priority unchanged."""
    now = datetime(2026, 3, 1, 12, 0, 0)
    created_at = now - timedelta(days=5)
    result = compute_urgency(0.7, deadline=None, created_at=created_at, now=now)
    assert result == 0.7


def test_urgency_scales_with_base_priority():
    """Higher base_priority → proportionally higher urgency."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=5)
    u1 = compute_urgency(1.0, deadline, created_at, now)
    u2 = compute_urgency(2.0, deadline, created_at, now)
    assert abs(u2 - 2 * u1) < 1e-9
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/scheduler/test_decay.py -v
```

Expected: FAIL — module not found.

**Step 3: Write `backend/scheduler/decay.py`**

```python
import math
from datetime import datetime

# --- Tunable constants (all decay parameters live here, never inline) ---
K_STEEPNESS: float = 2.5   # Controls how steeply urgency compounds near deadline
MIN_URGENCY: float = 0.01  # Floor — no task ever has zero urgency


def compute_urgency(
    base_priority: float,
    deadline: datetime | None,
    created_at: datetime,
    now: datetime | None = None,
) -> float:
    """
    Compute urgency using temporal decay:

        urgency(t) = base_priority * e^(K_STEEPNESS * (1 - days_remaining / total_days))

    - At creation (days_remaining == total_days): urgency == base_priority
    - At deadline (days_remaining == 0): urgency == base_priority * e^K_STEEPNESS
    - Past deadline or no total window: clamps to max urgency
    - No deadline: returns base_priority unchanged
    """
    if now is None:
        now = datetime.utcnow()

    if deadline is None:
        return base_priority

    total_days = (deadline - created_at).total_seconds() / 86400.0
    days_remaining = (deadline - now).total_seconds() / 86400.0

    if total_days <= 0 or days_remaining <= 0:
        # Already at or past deadline — max urgency
        return base_priority * math.exp(K_STEEPNESS)

    ratio = days_remaining / total_days
    urgency = base_priority * math.exp(K_STEEPNESS * (1.0 - ratio))
    return max(urgency, MIN_URGENCY)
```

**Step 4: Run to verify they pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/scheduler/test_decay.py -v
```

Expected: 6 tests PASS.

**Step 5: Commit**

```bash
git add backend/scheduler/decay.py tests/scheduler/test_decay.py
git commit -m "feat: add temporal decay urgency function with configurable constants"
```

---

## Task 3: AvailabilityWindow model + migration

**Files:**
- Create: `backend/models/availability_window.py`
- Modify: `backend/models/__init__.py`
- Create: `tests/models/test_availability_window.py`
- Modify: `tests/conftest.py`

**Step 1: Write failing test**

```python
# tests/models/test_availability_window.py
import uuid
from datetime import time
from backend.models.availability_window import AvailabilityWindow


def test_create_window_for_specific_day(db):
    w = AvailabilityWindow(
        id=str(uuid.uuid4()),
        day_of_week=0,          # Monday
        start_time=time(8, 0),
        end_time=time(18, 0),
        is_available=True,
    )
    db.add(w)
    db.commit()
    db.refresh(w)

    assert w.id is not None
    assert w.day_of_week == 0
    assert w.note is None


def test_create_window_for_all_days(db):
    """day_of_week=None means the window applies every day."""
    w = AvailabilityWindow(
        id=str(uuid.uuid4()),
        day_of_week=None,
        start_time=time(6, 0),
        end_time=time(22, 0),
        is_available=True,
        note="Default daily window",
    )
    db.add(w)
    db.commit()
    db.refresh(w)

    assert w.day_of_week is None
    assert w.note == "Default daily window"
```

**Step 2: Run to verify it fails**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/models/test_availability_window.py -v
```

Expected: FAIL.

**Step 3: Write `backend/models/availability_window.py`**

```python
import uuid
from datetime import time
from sqlalchemy import String, Integer, Time, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class AvailabilityWindow(Base):
    """
    Defines when the user is available to work.

    day_of_week = None means the window applies to every day.
    day_of_week = 0-6 (0 = Monday) scopes the window to that weekday.

    If no rows exist, the scheduler defaults to 6am–10pm every day.
    """
    __tablename__ = "availability_windows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0=Mon … 6=Sun, None=every day
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
```

**Step 4: Update `backend/models/__init__.py`**

Add to the existing file:
```python
from backend.models.availability_window import AvailabilityWindow
```

And add `"AvailabilityWindow"` to `__all__`.

Full updated file:
```python
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task, task_dependencies
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord
from backend.models.availability_window import AvailabilityWindow

__all__ = [
    "Goal",
    "Project",
    "Task",
    "task_dependencies",
    "EnergyProfile",
    "ScheduleBlock",
    "LearningRecord",
    "AvailabilityWindow",
]
```

**Step 5: Update `tests/conftest.py`** — add import:

```python
import backend.models.availability_window  # noqa: F401
```

**Step 6: Run to verify tests pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/models/test_availability_window.py -v
```

Expected: PASS.

**Step 7: Generate and run the migration**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run alembic revision --autogenerate -m "add_availability_window"
uv run alembic upgrade head
```

Expected: migration file created and applied without errors.

**Step 8: Verify**

```bash
uv run python -c "
from sqlalchemy import create_engine, inspect
engine = create_engine('sqlite:///eden.db')
print(inspect(engine).get_table_names())
"
```

Expected: `availability_windows` appears in the list.

**Step 9: Commit**

```bash
git add backend/models/availability_window.py backend/models/__init__.py \
        tests/models/test_availability_window.py tests/conftest.py \
        alembic/versions/
git commit -m "feat: add AvailabilityWindow model and migration"
```

---

## Task 4: backend/scheduler/constraints.py

**Files:**
- Create: `backend/scheduler/constraints.py`
- Create: `tests/scheduler/test_constraints.py`

This module owns the slot grid. A **TimeSlot** is a 30-minute interval identified by date + slot index within the day. The slot grid is all available TimeSlots across the 7-day horizon.

**Step 1: Write failing tests**

```python
# tests/scheduler/test_constraints.py
from datetime import date, time, datetime
from types import SimpleNamespace
from backend.scheduler.constraints import (
    TimeSlot,
    DEFAULT_START_HOUR,
    DEFAULT_END_HOUR,
    SLOT_MINUTES,
    build_slot_grid,
    is_slot_blocked,
    is_recovery_slot,
    get_slot_energy,
)


# --- TimeSlot ---

def test_timeslot_start_time():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)  # 8:00am (16 * 30 = 480 min)
    assert slot.start_time == time(8, 0)


def test_timeslot_end_time():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)
    assert slot.end_time == time(8, 30)


def test_timeslot_absolute_index():
    """Absolute index increases monotonically across days."""
    day1_slot = TimeSlot(date=date(2026, 3, 2), slot_index=0)
    day2_slot = TimeSlot(date=date(2026, 3, 3), slot_index=0)
    assert day2_slot.absolute_index > day1_slot.absolute_index


# --- build_slot_grid ---

def test_build_slot_grid_default_window():
    """With no availability windows, defaults to DEFAULT_START_HOUR–DEFAULT_END_HOUR every day."""
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[])
    # 7 days × (DEFAULT_END_HOUR - DEFAULT_START_HOUR) × 2 slots/hour
    expected_count = 7 * (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * (60 // SLOT_MINUTES)
    assert len(slots) == expected_count


def test_build_slot_grid_respects_custom_window():
    """Custom 2-hour window produces only 4 slots per day."""
    window = SimpleNamespace(day_of_week=None, start_time=time(9, 0), end_time=time(11, 0), is_available=True)
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[window])
    assert len(slots) == 7 * 4  # 7 days × 4 slots (2h × 2 slots/h)


def test_build_slot_grid_day_specific_window():
    """day_of_week=0 (Monday) window only applies to Mondays in the horizon."""
    # 2026-03-02 is a Monday
    window = SimpleNamespace(day_of_week=0, start_time=time(9, 0), end_time=time(11, 0), is_available=True)
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[window])
    assert len(slots) == 4  # Only Monday gets 4 slots; other 6 days get defaults


def test_build_slot_grid_spans_seven_days():
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[])
    dates = {s.date for s in slots}
    assert len(dates) == 7


# --- is_slot_blocked ---

def test_slot_is_blocked_by_fixed_block():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)  # 8:00–8:30
    block = SimpleNamespace(
        date=date(2026, 3, 2),
        start_time=time(8, 0),
        end_time=time(9, 0),
        task_id=None,
        overridden_by_user=False,
    )
    assert is_slot_blocked(slot, [block]) is True


def test_slot_not_blocked_when_no_overlap():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=20)  # 10:00–10:30
    block = SimpleNamespace(
        date=date(2026, 3, 2),
        start_time=time(8, 0),
        end_time=time(9, 0),
        task_id=None,
        overridden_by_user=False,
    )
    assert is_slot_blocked(slot, [block]) is False


def test_override_block_is_blocked():
    """overridden_by_user=True blocks the slot even if task_id is set."""
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)
    block = SimpleNamespace(
        date=date(2026, 3, 2),
        start_time=time(8, 0),
        end_time=time(9, 0),
        task_id="some-task",
        overridden_by_user=True,
    )
    assert is_slot_blocked(slot, [block]) is True


# --- is_recovery_slot ---

def test_recovery_slot_detected():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=14)  # 7:00am — Monday
    profile = SimpleNamespace(hour_of_day=7, day_of_week=0, is_post_hard_workout=True, energy_level=2)
    assert is_recovery_slot(slot, [profile]) is True


def test_non_recovery_slot():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=18)  # 9:00am
    profile = SimpleNamespace(hour_of_day=9, day_of_week=0, is_post_hard_workout=False, energy_level=4)
    assert is_recovery_slot(slot, [profile]) is False


# --- get_slot_energy ---

def test_get_energy_returns_profile_value():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=18)  # 9:00am Monday
    profile = SimpleNamespace(hour_of_day=9, day_of_week=0, is_post_hard_workout=False, energy_level=5)
    assert get_slot_energy(slot, [profile]) == 5


def test_get_energy_defaults_to_3():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=18)
    assert get_slot_energy(slot, []) == 3  # No profile → default
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/scheduler/test_constraints.py -v
```

Expected: FAIL.

**Step 3: Write `backend/scheduler/constraints.py`**

```python
from dataclasses import dataclass
from datetime import date, time, datetime, timedelta

# --- Constants ---
SLOT_MINUTES: int = 30
HORIZON_DAYS: int = 7
SLOTS_PER_DAY: int = (24 * 60) // SLOT_MINUTES  # 48
DEFAULT_START_HOUR: int = 6   # 6am
DEFAULT_END_HOUR: int = 22    # 10pm


@dataclass(frozen=True)
class TimeSlot:
    date: date
    slot_index: int  # 0 = 00:00, 1 = 00:30, ..., 47 = 23:30

    @property
    def start_time(self) -> time:
        total_minutes = self.slot_index * SLOT_MINUTES
        return time(total_minutes // 60, total_minutes % 60)

    @property
    def end_time(self) -> time:
        total_minutes = (self.slot_index + 1) * SLOT_MINUTES
        h, m = divmod(total_minutes, 60)
        return time(h % 24, m)

    @property
    def absolute_index(self) -> int:
        """Monotonically increasing integer across all days (used for ordering)."""
        epoch = date(2026, 1, 1)
        day_offset = (self.date - epoch).days
        return day_offset * SLOTS_PER_DAY + self.slot_index

    @property
    def hour(self) -> int:
        return (self.slot_index * SLOT_MINUTES) // 60

    @property
    def day_of_week(self) -> int:
        """0 = Monday."""
        return self.date.weekday()


def build_slot_grid(start_date: date, availability_windows: list) -> list[TimeSlot]:
    """
    Return all available TimeSlots for a HORIZON_DAYS window starting at start_date.

    Uses availability_windows to determine which hours are open on each day.
    If availability_windows is empty, defaults to DEFAULT_START_HOUR–DEFAULT_END_HOUR every day.
    """
    slots = []
    for day_offset in range(HORIZON_DAYS):
        current_date = start_date + timedelta(days=day_offset)
        dow = current_date.weekday()  # 0=Monday

        # Find applicable windows for this day
        applicable = [
            w for w in availability_windows
            if w.is_available and (w.day_of_week is None or w.day_of_week == dow)
        ]

        if applicable:
            for window in applicable:
                start_slot = _time_to_slot_index(window.start_time)
                end_slot = _time_to_slot_index(window.end_time)
                for idx in range(start_slot, end_slot):
                    slots.append(TimeSlot(date=current_date, slot_index=idx))
        else:
            # Default window
            for idx in range(
                DEFAULT_START_HOUR * (60 // SLOT_MINUTES),
                DEFAULT_END_HOUR * (60 // SLOT_MINUTES),
            ):
                slots.append(TimeSlot(date=current_date, slot_index=idx))

    return slots


def is_slot_blocked(slot: TimeSlot, fixed_blocks: list) -> bool:
    """
    Returns True if any fixed block overlaps this slot.

    Blocks with task_id=None are external calendar events.
    Blocks with overridden_by_user=True are sacred — scheduler cannot touch them.
    """
    for block in fixed_blocks:
        if block.date != slot.date:
            continue
        # Only block if it's an external event OR a user-overridden task block
        if block.task_id is not None and not block.overridden_by_user:
            continue
        if block.start_time <= slot.start_time < block.end_time:
            return True
    return False


def is_recovery_slot(slot: TimeSlot, energy_profiles: list) -> bool:
    """Returns True if the matching EnergyProfile marks this slot as post-hard-workout."""
    for profile in energy_profiles:
        if profile.hour_of_day == slot.hour and profile.day_of_week == slot.day_of_week:
            return profile.is_post_hard_workout
    return False


def get_slot_energy(slot: TimeSlot, energy_profiles: list) -> int:
    """
    Returns energy level (1–5) for this slot.
    Defaults to 3 (moderate) if no matching profile exists.
    """
    for profile in energy_profiles:
        if profile.hour_of_day == slot.hour and profile.day_of_week == slot.day_of_week:
            return profile.energy_level
    return 3


# --- Internal helpers ---

def _time_to_slot_index(t: time) -> int:
    return (t.hour * 60 + t.minute) // SLOT_MINUTES
```

**Step 4: Run to verify they pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/scheduler/test_constraints.py -v
```

Expected: all tests PASS. Note: `test_build_slot_grid_day_specific_window` expects only 4 slots (Monday only). The other 6 days should fall back to the default window — verify the count matches `4 + 6 * (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 2`.

If the day-specific test count is off, re-read the test comment and adjust the assertion to `4 + 6 * (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * 2` — the test as written expects only Monday's 4 slots which is incorrect for the fallback case. Correct assertion:

```python
expected = 4 + 6 * (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * (60 // SLOT_MINUTES)
assert len(slots) == expected
```

Update the test accordingly.

**Step 5: Commit**

```bash
git add backend/scheduler/constraints.py tests/scheduler/test_constraints.py
git commit -m "feat: add TimeSlot, slot grid, and blocked/recovery/energy helpers"
```

---

## Task 5: backend/scheduler/engine.py

**Files:**
- Create: `backend/scheduler/engine.py`
- Create: `tests/scheduler/test_engine.py`

The engine takes plain Python objects (attributes accessed via dot notation — works with SQLAlchemy models, `SimpleNamespace`, or any object). It returns `ScheduleBlockResult` dataclasses. The caller handles DB persistence.

**Step 1: Write failing tests**

```python
# tests/scheduler/test_engine.py
import uuid
from datetime import date, time, datetime, timedelta
from types import SimpleNamespace
from backend.scheduler.engine import SchedulerEngine, ScheduleBlockResult


# --- Helpers ---

def make_task(
    cognitive_load=2,
    estimated_minutes=60,
    deadline=None,
    created_at=None,
    dependencies=None,
    status="active",
):
    now = datetime(2026, 3, 1, 12, 0, 0)
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        cognitive_load=cognitive_load,
        estimated_minutes=estimated_minutes,
        deadline=deadline,
        created_at=created_at or (now - timedelta(days=5)),
        dependencies=dependencies or [],
        status=status,
    )


def make_block(d, start_h, end_h, task_id=None, overridden_by_user=False):
    return SimpleNamespace(
        date=d,
        start_time=time(start_h, 0),
        end_time=time(end_h, 0),
        task_id=task_id,
        overridden_by_user=overridden_by_user,
    )


START = date(2026, 3, 2)  # Monday
ENGINE = SchedulerEngine()


# --- Basic scheduling ---

def test_single_task_gets_scheduled():
    task = make_task(estimated_minutes=30)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    assert results[0].task_id == task.id


def test_task_fills_correct_number_of_slots():
    """A 90-minute task requires 3 ×30-min slots."""
    task = make_task(estimated_minutes=90)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 3


def test_results_are_schedule_block_results():
    task = make_task(estimated_minutes=30)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert isinstance(results[0], ScheduleBlockResult)
    assert results[0].auto_generated is True
    assert results[0].overridden_by_user is False


# --- Hard constraint: blocked slots ---

def test_task_not_placed_in_blocked_slot():
    """External calendar block at 6am–10am on Monday → task must go elsewhere."""
    task = make_task(estimated_minutes=30)
    block = make_block(START, start_h=6, end_h=10)  # blocks first 8 slots of day
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[block],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    result = results[0]
    # Result must not overlap the blocked period
    if result.date == START:
        assert result.start_time >= time(10, 0)


# --- Hard constraint: manual override immutability ---

def test_overridden_block_is_never_displaced():
    """overridden_by_user=True slot must remain untouched."""
    task = make_task(estimated_minutes=30)
    override_block = make_block(START, start_h=8, end_h=9, task_id="other-task", overridden_by_user=True)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[override_block],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    result = results[0]
    if result.date == START:
        assert not (result.start_time >= time(8, 0) and result.start_time < time(9, 0))


# --- Hard constraint: recovery flag ---

def test_high_load_task_not_placed_in_recovery_slot():
    """cognitive_load=3 task must not go in a recovery slot."""
    task = make_task(cognitive_load=3, estimated_minutes=30)
    # Mark 6am–10am (slots 12–19) on Monday as recovery
    profiles = [
        SimpleNamespace(hour_of_day=h, day_of_week=0, is_post_hard_workout=True, energy_level=2)
        for h in range(6, 10)
    ]
    # Also mark remaining hours (non-recovery) so solver has somewhere to put it
    profiles += [
        SimpleNamespace(hour_of_day=h, day_of_week=0, is_post_hard_workout=False, energy_level=4)
        for h in range(10, 22)
    ]
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=profiles,
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    if results[0].date == START:
        assert results[0].start_time >= time(10, 0)


def test_low_load_task_allowed_in_recovery_slot():
    """cognitive_load=1 task CAN go in a recovery slot."""
    task = make_task(cognitive_load=1, estimated_minutes=30)
    profiles = [
        SimpleNamespace(hour_of_day=6, day_of_week=0, is_post_hard_workout=True, energy_level=2)
    ]
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=profiles,
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1  # scheduled somewhere — recovery slot is allowed


# --- Hard constraint: deadline ---

def test_task_not_scheduled_past_deadline():
    """Task deadline is tomorrow — must be scheduled within today or tomorrow."""
    now = datetime(2026, 3, 1, 12, 0, 0)
    deadline = datetime(2026, 3, 3, 23, 59, 59)  # Tuesday EOD
    task = make_task(estimated_minutes=30, deadline=deadline, created_at=now - timedelta(days=5))
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=now,
        start_date=START,
    )
    assert len(results) == 1
    result = results[0]
    assert datetime.combine(result.date, result.end_time) <= deadline


# --- Hard constraint: dependency ordering ---

def test_dependency_ordering():
    """
    Task B depends on Task A.
    All of A's scheduled slots must come before all of B's slots.
    """
    task_a = make_task(estimated_minutes=30)
    task_b = make_task(estimated_minutes=30, dependencies=[task_a])
    results = ENGINE.run(
        tasks=[task_a, task_b],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    a_results = [r for r in results if r.task_id == task_a.id]
    b_results = [r for r in results if r.task_id == task_b.id]
    assert a_results and b_results

    max_a_end = max(datetime.combine(r.date, r.end_time) for r in a_results)
    min_b_start = min(datetime.combine(r.date, r.start_time) for r in b_results)
    assert max_a_end <= min_b_start


# --- Determinism ---

def test_engine_is_deterministic():
    """Same input → same output on repeated runs."""
    tasks = [make_task(estimated_minutes=60) for _ in range(3)]
    kwargs = dict(
        tasks=tasks,
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    run1 = ENGINE.run(**kwargs)
    run2 = ENGINE.run(**kwargs)

    assert len(run1) == len(run2)
    for r1, r2 in zip(sorted(run1, key=lambda r: (r.task_id, r.date, r.start_time)),
                      sorted(run2, key=lambda r: (r.task_id, r.date, r.start_time))):
        assert r1.task_id == r2.task_id
        assert r1.date == r2.date
        assert r1.start_time == r2.start_time
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/scheduler/test_engine.py -v
```

Expected: FAIL — module not found.

**Step 3: Write `backend/scheduler/engine.py`**

```python
import math
from dataclasses import dataclass
from datetime import date, time, datetime, timedelta

from ortools.sat.python import cp_model

from backend.scheduler.constraints import (
    TimeSlot,
    build_slot_grid,
    is_slot_blocked,
    is_recovery_slot,
    get_slot_energy,
)
from backend.scheduler.decay import compute_urgency

# Solver timeout in seconds — keeps the engine responsive
SOLVER_TIMEOUT_SECONDS: int = 30
# Scale factor to convert float urgency/energy into CP-SAT integer coefficients
SCORE_SCALE: int = 1000


@dataclass
class ScheduleBlockResult:
    task_id: str
    date: date
    start_time: time
    end_time: time
    auto_generated: bool = True
    overridden_by_user: bool = False


class SchedulerEngine:
    """
    Deterministic CP-SAT scheduler.

    Tasks are split into 30-minute units. Each unit is independently assigned
    to a time slot. Hard constraints are strictly enforced; soft constraints
    are captured in the objective (urgency × energy fit).
    """

    def run(
        self,
        tasks: list,
        fixed_blocks: list,
        energy_profiles: list,
        availability_windows: list,
        now: datetime | None = None,
        start_date: date | None = None,
    ) -> list[ScheduleBlockResult]:
        if now is None:
            now = datetime.utcnow()
        if start_date is None:
            start_date = now.date()

        # Only schedule tasks that need work
        schedulable = [
            t for t in tasks
            if getattr(t, "status", "active") in ("active", "backlog", "in_progress")
        ]
        if not schedulable:
            return []

        slots = build_slot_grid(start_date, availability_windows)
        if not slots:
            return []

        # Precompute blocked and recovery sets (by absolute index for fast lookup)
        blocked_abs = {
            s.absolute_index for s in slots if is_slot_blocked(s, fixed_blocks)
        }
        recovery_abs = {
            s.absolute_index for s in slots if is_recovery_slot(s, energy_profiles)
        }
        energy_map = {s.absolute_index: get_slot_energy(s, energy_profiles) for s in slots}

        # Build absolute-index lookup for deadline enforcement
        slot_abs_list = [s.absolute_index for s in slots]
        slot_by_abs = {s.absolute_index: s for s in slots}

        # Units per task: ceil(estimated_minutes / 30)
        from math import ceil
        units_per_task = [ceil(t.estimated_minutes / 30) for t in schedulable]

        # Urgency per task (scaled to integer)
        urgency_scores = []
        for t in schedulable:
            u = compute_urgency(
                base_priority=1.0,
                deadline=t.deadline,
                created_at=t.created_at,
                now=now,
            )
            urgency_scores.append(int(u * SCORE_SCALE))

        # --- Build CP-SAT model ---
        model = cp_model.CpModel()
        n_tasks = len(schedulable)
        n_slots = len(slots)

        # x[t][s] = 1 iff task unit t is assigned to slot s
        # We create one variable per (task, slot) pair
        x = [[model.NewBoolVar(f"x_{t}_{s}") for s in range(n_slots)] for t in range(n_tasks)]

        # --- Hard constraint 1: Each task fills exactly units_per_task[t] slots ---
        for t in range(n_tasks):
            model.Add(sum(x[t][s] for s in range(n_slots)) == units_per_task[t])

        # --- Hard constraint 2: Each slot holds at most one task unit ---
        for s in range(n_slots):
            model.Add(sum(x[t][s] for t in range(n_tasks)) <= 1)

        # --- Hard constraint 3: Blocked slots ---
        for s, slot in enumerate(slots):
            if slot.absolute_index in blocked_abs:
                for t in range(n_tasks):
                    model.Add(x[t][s] == 0)

        # --- Hard constraint 4: Recovery slots (only cognitive_load=1 allowed) ---
        for s, slot in enumerate(slots):
            if slot.absolute_index in recovery_abs:
                for t, task in enumerate(schedulable):
                    if task.cognitive_load > 1:
                        model.Add(x[t][s] == 0)

        # --- Hard constraint 5: Deadline enforcement ---
        for t, task in enumerate(schedulable):
            if task.deadline is None:
                continue
            deadline_dt = task.deadline
            for s, slot in enumerate(slots):
                slot_end_dt = datetime.combine(slot.date, slot.end_time)
                if slot_end_dt > deadline_dt:
                    model.Add(x[t][s] == 0)

        # --- Hard constraint 6: Dependency ordering ---
        # For each dependency edge (task_b depends on task_a):
        # All slots of a must have lower absolute_index than all slots of b.
        # Enforce: x[a][s_a] + x[b][s_b] <= 1 for all s_a, s_b where abs(s_a) >= abs(s_b)
        task_id_to_idx = {task.id: idx for idx, task in enumerate(schedulable)}
        for b_idx, task_b in enumerate(schedulable):
            for dep in task_b.dependencies:
                dep_id = dep.id if hasattr(dep, "id") else dep
                a_idx = task_id_to_idx.get(dep_id)
                if a_idx is None:
                    continue
                for s_b in range(n_slots):
                    abs_b = slots[s_b].absolute_index
                    for s_a in range(n_slots):
                        if slots[s_a].absolute_index >= abs_b:
                            model.Add(x[a_idx][s_a] + x[b_idx][s_b] <= 1)

        # --- Soft objective: maximize urgency × energy fit ---
        obj_terms = []
        for t, task in enumerate(schedulable):
            urgency = urgency_scores[t]
            for s, slot in enumerate(slots):
                energy = energy_map.get(slot.absolute_index, 3)
                if task.cognitive_load == 3:
                    weight = urgency * energy  # deep focus: energy matters
                else:
                    weight = urgency
                if weight > 0:
                    obj_terms.append(weight * x[t][s])

        if obj_terms:
            model.Maximize(sum(obj_terms))

        # --- Solve ---
        solver = cp_model.CpSolver()
        solver.parameters.random_seed = 42       # determinism
        solver.parameters.max_time_in_seconds = SOLVER_TIMEOUT_SECONDS

        status = solver.Solve(model)

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return []

        # --- Extract results ---
        results = []
        for t, task in enumerate(schedulable):
            for s, slot in enumerate(slots):
                if solver.Value(x[t][s]) == 1:
                    results.append(ScheduleBlockResult(
                        task_id=task.id,
                        date=slot.date,
                        start_time=slot.start_time,
                        end_time=slot.end_time,
                        auto_generated=True,
                        overridden_by_user=False,
                    ))

        return results
```

**Step 4: Run to verify they pass**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/scheduler/test_engine.py -v
```

Expected: all tests PASS. The dependency ordering test in particular exercises the core hard constraints.

If the dependency test times out (large constraint matrix), reduce the number of slot pairs by limiting to adjacent days only. Add this optimization inside the dependency loop:

```python
# Only add constraint if s_b is within 7 days of s_a (reduces constraint count)
if abs(slots[s_a].absolute_index - abs_b) < 7 * 48:
    model.Add(x[a_idx][s_a] + x[b_idx][s_b] <= 1)
```

**Step 5: Run full test suite**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
uv run pytest tests/ -v
```

Expected: all tests PASS (17 existing + new scheduler tests).

**Step 6: Commit**

```bash
git add backend/scheduler/engine.py tests/scheduler/test_engine.py
git commit -m "feat: add OR-Tools CP-SAT scheduler engine with hard constraints and urgency objective"
```

---

## Done

At this point you have:

- `backend/scheduler/decay.py` — temporal decay urgency with all constants configurable
- `backend/scheduler/constraints.py` — TimeSlot, 7-day slot grid, blocked/recovery/energy detection
- `backend/models/availability_window.py` — user availability model with Alembic migration
- `backend/scheduler/engine.py` — deterministic CP-SAT solver enforcing all CLAUDE.md hard constraints

Next layer: LLM intelligence layer (`backend/intelligence/context.py`, `prompts.py`, `client.py`).
