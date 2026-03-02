# Circadian Scheduling Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Model the user's chronobiology (wake time + chronotype) and use it to auto-populate a science-based energy profile, so Eden schedules deep work when the brain is biologically primed for it — not just when there's a gap.

**Architecture:** A new `UserProfile` single-row table stores `wake_hour` and `chronotype`. A pure function in `circadian.py` converts these into a 7×24 energy grid using the CAR (Cortisol Awakening Response) + CBT (Core Body Temperature) research model. The Settings view gains a "Chronotype" section with a one-click "Apply to energy profile" button. The user profile is added to every LLM context snapshot so Eden can reason about it.

**Tech Stack:** SQLAlchemy + Alembic (backend model/migration), FastAPI (API route), React + TanStack Query (frontend), existing `setEnergyProfile` API for applying defaults.

---

## The Science Model

The energy curve is anchored to `wake_hour` (0–23). Offsets are hours after waking:

| Offset | Energy | Why |
|--------|--------|-----|
| 0 | 2 | Just waking — adenosine still clearing |
| 1 | 4 | CAR peak rising fast |
| 2–4 | 5 | **Peak cognitive window** — deep work here |
| 5 | 4 | Post-peak |
| 6 | 3 | Stabilizing |
| 7–8 | 2 | **Post-lunch nadir** — body temp dip, load=1 only |
| 9–10 | 4 | **Secondary peak** — CBT peak |
| 11 | 3 | Declining |
| 12 | 2 | |
| 13+ | 1 | Wind-down |

Computed as: `offset = (clock_hour - wake_hour) % 24`. Any offset beyond 13 → energy=1.

The profile is identical across all 7 days (weekday/weekend differentiation is v2).

---

## Key Files to Understand First

Before implementing, read these files to understand existing patterns:
- `backend/models/energy_profile.py` — model pattern to copy
- `backend/models/__init__.py` — register new model here
- `backend/api/energy_profile.py` — API pattern to follow
- `backend/scheduler/constraints.py` — `get_slot_energy()` reads EnergyProfile rows
- `backend/intelligence/context.py` — `build_context_snapshot()` where user_profile goes
- `alembic/versions/ecf4a26ec98d_add_availability_window.py` — migration pattern to follow
- `frontend/src/views/Settings.tsx` — UI to extend
- `frontend/src/api/energy_profile.ts` — `setEnergyProfile()` for "apply" button
- `tests/conftest.py` — test DB fixture pattern

---

## Task 1: UserProfile model + Alembic migration

**Files:**
- Create: `backend/models/user_profile.py`
- Modify: `backend/models/__init__.py`
- Create: `alembic/versions/a1b2c3d4e5f6_add_user_profile.py`

**Step 1: Write the failing test**

Create `tests/models/test_user_profile.py`:

```python
import uuid
from datetime import date
from backend.models.user_profile import UserProfile


def test_user_profile_model(db):
    profile = UserProfile(id=str(uuid.uuid4()), wake_hour=7, chronotype="intermediate")
    db.add(profile)
    db.commit()
    fetched = db.get(UserProfile, profile.id)
    assert fetched.wake_hour == 7
    assert fetched.chronotype == "intermediate"
```

**Step 2: Run test to verify it fails**

```bash
source .venv/bin/activate && pytest tests/models/test_user_profile.py -v
```

Expected: `FAIL` — `ModuleNotFoundError: No module named 'backend.models.user_profile'`

**Step 3: Create the model**

Create `backend/models/user_profile.py`:

```python
import uuid
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class UserProfile(Base):
    __tablename__ = "user_profile"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    wake_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=7)      # 0–23
    chronotype: Mapped[str] = mapped_column(String(20), nullable=False, default="intermediate")  # early/intermediate/late
```

Register it in `backend/models/__init__.py` — add `from backend.models.user_profile import UserProfile` and add `"UserProfile"` to `__all__`.

**Step 4: Run test to verify it passes**

```bash
pytest tests/models/test_user_profile.py -v
```

Expected: `PASS`

**Step 5: Write the migration**

Create `alembic/versions/a1b2c3d4e5f6_add_user_profile.py`:

```python
"""add_user_profile

Revision ID: a1b2c3d4e5f6
Revises: ecf4a26ec98d
Create Date: 2026-03-02

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'ecf4a26ec98d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'user_profile',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('wake_hour', sa.Integer(), nullable=False),
        sa.Column('chronotype', sa.String(length=20), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('user_profile')
```

Verify migration applies:

```bash
source .venv/bin/activate && alembic upgrade head
```

Expected: runs without error, `user_profile` table created.

**Step 6: Commit**

```bash
git add backend/models/user_profile.py backend/models/__init__.py alembic/versions/a1b2c3d4e5f6_add_user_profile.py tests/models/test_user_profile.py
git commit -m "feat: add UserProfile model and migration"
```

---

## Task 2: Circadian energy defaults function

**Files:**
- Create: `backend/scheduler/circadian.py`
- Create: `tests/scheduler/test_circadian.py`

**Step 1: Write the failing tests**

Create `tests/scheduler/test_circadian.py`:

```python
from backend.scheduler.circadian import build_energy_defaults


def test_returns_168_entries():
    result = build_energy_defaults(wake_hour=7)
    assert len(result) == 7 * 24  # 7 days × 24 hours


def test_all_seven_days_present():
    result = build_energy_defaults(wake_hour=7)
    days = {e["day_of_week"] for e in result}
    assert days == {0, 1, 2, 3, 4, 5, 6}


def test_all_24_hours_per_day():
    result = build_energy_defaults(wake_hour=7)
    for day in range(7):
        hours = [e["hour_of_day"] for e in result if e["day_of_week"] == day]
        assert sorted(hours) == list(range(24))


def test_peak_window_is_5():
    # wake_hour=7 → peak window is 9,10,11 (offsets 2,3,4)
    result = build_energy_defaults(wake_hour=7)
    peak_hours = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (9, 10, 11)]
    assert all(e["energy_level"] == 5 for e in peak_hours)


def test_nadir_is_2():
    # wake_hour=7 → nadir is 14,15 (offsets 7,8)
    result = build_energy_defaults(wake_hour=7)
    nadir_hours = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (14, 15)]
    assert all(e["energy_level"] == 2 for e in nadir_hours)


def test_secondary_peak_is_4():
    # wake_hour=7 → secondary peak is 16,17 (offsets 9,10)
    result = build_energy_defaults(wake_hour=7)
    secondary = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (16, 17)]
    assert all(e["energy_level"] == 4 for e in secondary)


def test_pre_wake_is_1():
    # wake_hour=7 → hours 0-6 are before wake (offsets 17-23 wrap-around)
    result = build_energy_defaults(wake_hour=7)
    pre_wake = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in range(1, 7)]
    assert all(e["energy_level"] == 1 for e in pre_wake)


def test_all_energy_levels_in_range():
    result = build_energy_defaults(wake_hour=7)
    assert all(1 <= e["energy_level"] <= 5 for e in result)


def test_late_wake_hour():
    # wake_hour=10 → peak window is 12,13,14
    result = build_energy_defaults(wake_hour=10)
    peak = [e for e in result if e["day_of_week"] == 0 and e["hour_of_day"] in (12, 13, 14)]
    assert all(e["energy_level"] == 5 for e in peak)


def test_same_across_all_days():
    result = build_energy_defaults(wake_hour=7)
    day0 = {e["hour_of_day"]: e["energy_level"] for e in result if e["day_of_week"] == 0}
    day6 = {e["hour_of_day"]: e["energy_level"] for e in result if e["day_of_week"] == 6}
    assert day0 == day6
```

**Step 2: Run tests to verify they fail**

```bash
source .venv/bin/activate && pytest tests/scheduler/test_circadian.py -v
```

Expected: `FAIL` — `ModuleNotFoundError`

**Step 3: Implement `circadian.py`**

Create `backend/scheduler/circadian.py`:

```python
# Energy level at each hour offset from wake time.
# Based on: Cortisol Awakening Response (CAR), Core Body Temperature (CBT) curve,
# and post-lunch dip research.
_WAKE_OFFSET_ENERGY: dict[int, int] = {
    0: 2,   # Just waking — adenosine clearing, cortisol rising
    1: 4,   # CAR peak
    2: 5,   # Deep work window begins
    3: 5,
    4: 5,   # Deep work window ends
    5: 4,   # Post-peak
    6: 3,   # Stabilizing
    7: 2,   # Post-lunch nadir — body temperature dip
    8: 2,
    9: 4,   # Secondary peak — CBT peak
    10: 4,
    11: 3,  # Declining
    12: 2,
    13: 1,  # Wind-down begins
}

_DEFAULT_ENERGY: int = 1  # Any offset > 13 or before wake


def build_energy_defaults(wake_hour: int) -> list[dict]:
    """
    Return a 7-day × 24-hour energy profile anchored to wake_hour.

    The same curve is applied to every day of the week.
    Each entry: {"day_of_week": 0-6, "hour_of_day": 0-23, "energy_level": 1-5}

    Curve logic: offset = (clock_hour - wake_hour) % 24
    Offsets 2-4 → energy 5 (deep work window)
    Offsets 7-8 → energy 2 (nadir)
    Offsets 9-10 → energy 4 (secondary peak)
    """
    entries = []
    for day in range(7):
        for hour in range(24):
            offset = (hour - wake_hour) % 24
            energy = _WAKE_OFFSET_ENERGY.get(offset, _DEFAULT_ENERGY)
            entries.append({
                "day_of_week": day,
                "hour_of_day": hour,
                "energy_level": energy,
            })
    return entries
```

**Step 4: Run tests to verify they pass**

```bash
pytest tests/scheduler/test_circadian.py -v
```

Expected: `10 passed`

**Step 5: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing, no regressions.

**Step 6: Commit**

```bash
git add backend/scheduler/circadian.py tests/scheduler/test_circadian.py
git commit -m "feat: circadian energy defaults function (CAR/CBT model)"
```

---

## Task 3: UserProfile API

**Files:**
- Modify: `backend/api/schemas.py` (add UserProfileUpdate, UserProfileResponse)
- Create: `backend/api/user_profile.py`
- Modify: `backend/main.py` (wire router)
- Create: `tests/api/test_user_profile.py`

**Step 1: Write the failing tests**

Create `tests/api/test_user_profile.py`:

```python
def test_get_user_profile_empty(client):
    r = client.get("/api/user-profile")
    assert r.status_code == 200
    data = r.json()
    assert data["wake_hour"] == 7
    assert data["chronotype"] == "intermediate"


def test_update_user_profile(client):
    r = client.put("/api/user-profile", json={"wake_hour": 6, "chronotype": "early"})
    assert r.status_code == 200
    data = r.json()
    assert data["wake_hour"] == 6
    assert data["chronotype"] == "early"


def test_update_persists(client):
    client.put("/api/user-profile", json={"wake_hour": 9, "chronotype": "late"})
    r = client.get("/api/user-profile")
    assert r.json()["wake_hour"] == 9


def test_get_energy_defaults(client):
    client.put("/api/user-profile", json={"wake_hour": 7, "chronotype": "intermediate"})
    r = client.get("/api/user-profile/energy-defaults")
    assert r.status_code == 200
    data = r.json()
    assert len(data) == 168  # 7 × 24
    assert all("day_of_week" in e and "hour_of_day" in e and "energy_level" in e for e in data)


def test_energy_defaults_reflect_wake_hour(client):
    client.put("/api/user-profile", json={"wake_hour": 8, "chronotype": "intermediate"})
    r = client.get("/api/user-profile/energy-defaults")
    entries = r.json()
    # wake_hour=8 → peak window hours 10,11,12 (offsets 2,3,4)
    peak = [e for e in entries if e["day_of_week"] == 0 and e["hour_of_day"] in (10, 11, 12)]
    assert all(e["energy_level"] == 5 for e in peak)


def test_wake_hour_validation(client):
    r = client.put("/api/user-profile", json={"wake_hour": 25, "chronotype": "intermediate"})
    assert r.status_code == 422


def test_chronotype_validation(client):
    r = client.put("/api/user-profile", json={"wake_hour": 7, "chronotype": "vampire"})
    assert r.status_code == 422
```

**Step 2: Run tests to verify they fail**

```bash
source .venv/bin/activate && pytest tests/api/test_user_profile.py -v
```

Expected: `FAIL` — 404 Not Found (routes don't exist yet)

**Step 3: Add schemas**

In `backend/api/schemas.py`, add after the AvailabilityResponse class:

```python
# --- User Profile ---

class UserProfileUpdate(BaseModel):
    wake_hour: int      # validated range 0-23 below
    chronotype: Literal["early", "intermediate", "late"]

    @field_validator("wake_hour")
    @classmethod
    def validate_wake_hour(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("wake_hour must be 0–23")
        return v


class UserProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    wake_hour: int
    chronotype: str
```

Also add `field_validator` to the imports at the top of schemas.py:
```python
from pydantic import BaseModel, field_validator
```

**Step 4: Create `backend/api/user_profile.py`**

```python
import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.user_profile import UserProfile
from backend.api.schemas import UserProfileUpdate, UserProfileResponse
from backend.scheduler.circadian import build_energy_defaults

router = APIRouter(prefix="/api/user-profile", tags=["user-profile"])

_DEFAULT_WAKE_HOUR = 7
_DEFAULT_CHRONOTYPE = "intermediate"


def _get_or_create_profile(db: Session) -> UserProfile:
    profile = db.query(UserProfile).first()
    if not profile:
        profile = UserProfile(
            id=str(uuid.uuid4()),
            wake_hour=_DEFAULT_WAKE_HOUR,
            chronotype=_DEFAULT_CHRONOTYPE,
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("", response_model=UserProfileResponse)
def get_user_profile(db: Session = Depends(get_db)):
    return _get_or_create_profile(db)


@router.put("", response_model=UserProfileResponse)
def update_user_profile(body: UserProfileUpdate, db: Session = Depends(get_db)):
    profile = _get_or_create_profile(db)
    profile.wake_hour = body.wake_hour
    profile.chronotype = body.chronotype
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/energy-defaults")
def get_energy_defaults(db: Session = Depends(get_db)):
    profile = _get_or_create_profile(db)
    return build_energy_defaults(profile.wake_hour)
```

**Step 5: Wire router in `backend/main.py`**

Add import:
```python
from backend.api.user_profile import router as user_profile_router
```

Add router:
```python
app.include_router(user_profile_router)
```

**Step 6: Run tests to verify they pass**

```bash
pytest tests/api/test_user_profile.py -v
```

Expected: `7 passed`

**Step 7: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 8: Commit**

```bash
git add backend/api/schemas.py backend/api/user_profile.py backend/main.py tests/api/test_user_profile.py
git commit -m "feat: UserProfile API with circadian energy defaults endpoint"
```

---

## Task 4: Context snapshot — add user profile

**Files:**
- Modify: `backend/intelligence/context.py`
- Modify: `tests/intelligence/test_context.py` (if it exists) or add to `test_client.py`

**Step 1: Write the failing test**

In `tests/intelligence/test_client.py`, add a test after the existing ones:

```python
def test_context_snapshot_includes_user_profile(db):
    from backend.intelligence.context import build_context_snapshot
    snapshot = build_context_snapshot(db)
    assert "user_profile" in snapshot
    assert "wake_hour" in snapshot["user_profile"]
    assert "chronotype" in snapshot["user_profile"]
```

**Step 2: Run test to verify it fails**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_client.py::test_context_snapshot_includes_user_profile -v
```

Expected: `FAIL` — `AssertionError: 'user_profile' not in snapshot`

**Step 3: Update `context.py`**

Add `_build_user_profile` function:

```python
def _build_user_profile(db: Session) -> dict:
    from backend.models.user_profile import UserProfile
    profile = db.query(UserProfile).first()
    if not profile:
        return {"wake_hour": 7, "chronotype": "intermediate"}
    return {"wake_hour": profile.wake_hour, "chronotype": profile.chronotype}
```

Add to `build_context_snapshot` return dict:

```python
return {
    "goals": _build_goals(db),
    "projects": _build_projects(db),
    "tasks": _build_tasks(db, now),
    "schedule": _build_schedule(db, now),
    "energy_profile": _build_energy_profile(db, now),
    "learning_summary": _build_learning_summary(db),
    "alerts": _build_alerts(db, now),
    "user_profile": _build_user_profile(db),
}
```

**Step 4: Run test to verify it passes**

```bash
pytest tests/intelligence/test_client.py -v
```

Expected: all passing including the new test.

**Step 5: Run full suite**

```bash
pytest tests/ -q
```

Expected: all passing.

**Step 6: Commit**

```bash
git add backend/intelligence/context.py tests/intelligence/test_client.py
git commit -m "feat: add user_profile to LLM context snapshot"
```

---

## Task 5: Frontend types + API

**Files:**
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/api/user_profile.ts`

No tests needed for these (pure type definitions + thin fetch wrappers — tested via integration).

**Step 1: Add `UserProfile` type to `frontend/src/types.ts`**

Add after the `AvailabilityWindow` interface:

```typescript
export interface UserProfile {
  id: string
  wake_hour: number
  chronotype: 'early' | 'intermediate' | 'late'
}

export interface EnergyDefault {
  day_of_week: number
  hour_of_day: number
  energy_level: number
}
```

**Step 2: Create `frontend/src/api/user_profile.ts`**

```typescript
import { apiFetch } from './client'
import type { UserProfile, EnergyDefault } from '../types'

export const getUserProfile = () =>
  apiFetch<UserProfile>('/user-profile')

export const updateUserProfile = (body: { wake_hour: number; chronotype: string }) =>
  apiFetch<UserProfile>('/user-profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

export const getEnergyDefaults = () =>
  apiFetch<EnergyDefault[]>('/user-profile/energy-defaults')
```

**Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Commit**

```bash
git add frontend/src/types.ts frontend/src/api/user_profile.ts
git commit -m "feat: UserProfile frontend types and API client"
```

---

## Task 6: Settings UI — Chronotype section

**Files:**
- Modify: `frontend/src/views/Settings.tsx`

**Step 1: Add `ChronotypeSection` component at the top of `Settings.tsx`**

Add these imports at the top of Settings.tsx:

```typescript
import { getUserProfile, updateUserProfile, getEnergyDefaults } from '../api/user_profile'
import { setEnergyProfile } from '../api/energy_profile'
import type { UserProfile } from '../types'
```

Add the `ChronotypeSection` component before `EnergyGrid` in the file:

```typescript
const CHRONOTYPE_OPTIONS = [
  { value: 'early', label: 'Early bird', hint: 'Natural wake ~5–6am' },
  { value: 'intermediate', label: 'Intermediate', hint: 'Natural wake ~7–8am' },
  { value: 'late', label: 'Night owl', hint: 'Natural wake ~9–10am' },
] as const

function ChronotypeSection() {
  const qc = useQueryClient()
  const { data: profile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: getUserProfile,
  })

  const [wakeHour, setWakeHour] = useState<number>(profile?.wake_hour ?? 7)
  const [chronotype, setChronotype] = useState<string>(profile?.chronotype ?? 'intermediate')
  const [saved, setSaved] = useState(false)
  const [applying, setApplying] = useState(false)

  // Sync local state when profile loads
  useEffect(() => {
    if (profile) {
      setWakeHour(profile.wake_hour)
      setChronotype(profile.chronotype)
    }
  }, [profile])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => updateUserProfile({ wake_hour: wakeHour, chronotype }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const { mutate: applyDefaults } = useMutation({
    mutationFn: async () => {
      // Save profile first, then fetch the computed defaults, then apply to energy grid
      await updateUserProfile({ wake_hour: wakeHour, chronotype })
      const defaults = await getEnergyDefaults()
      return setEnergyProfile(defaults)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] })
      qc.invalidateQueries({ queryKey: ['energy-profile'] })
      setApplying(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onMutate: () => setApplying(true),
  })

  // Convert wake_hour (0-23) to HH:MM string for <input type="time">
  const wakeTimeStr = `${String(wakeHour).padStart(2, '0')}:00`

  function handleWakeTimeChange(val: string) {
    const [h] = val.split(':').map(Number)
    if (!isNaN(h) && h >= 0 && h <= 23) setWakeHour(h)
  }

  return (
    <div className="space-y-4">
      <p className="text-zinc-600 text-xs">
        Eden schedules deep work (load=3) in your peak cognitive window — 2–4h after waking.
        Set your wake time and Eden pre-populates your energy profile with the science-based curve.
      </p>

      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-zinc-600 text-xs">Wake time</span>
          <input
            type="time"
            value={wakeTimeStr}
            onChange={(e) => handleWakeTimeChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs w-28"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-zinc-600 text-xs">Chronotype</span>
          <select
            value={chronotype}
            onChange={(e) => setChronotype(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs"
          >
            {CHRONOTYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.hint}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => save()}
          disabled={saving || saved}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
        >
          {saving ? '...' : saved ? '[ saved ✓ ]' : '[ save ]'}
        </button>
        <button
          onClick={() => applyDefaults()}
          disabled={applying}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 border border-zinc-700 disabled:border-zinc-800 px-2 py-0.5 transition-colors"
        >
          {applying ? 'applying...' : '[ apply to energy profile ]'}
        </button>
        <span className="text-zinc-700 text-xs">
          overwrites your energy grid with the science-based curve
        </span>
      </div>
    </div>
  )
}
```

**Step 2: Add the section to the Settings view**

In the `Settings` component's return, add the Chronotype section before the Energy Profile section:

```typescript
<section>
  <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
    Chronotype
  </h2>
  <ChronotypeSection />
</section>

<section>
  <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
    Energy Profile
  </h2>
  <EnergyGrid />
</section>
```

**Step 3: Verify TypeScript compiles**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit
```

Expected: no errors.

**Step 4: Run full test suite**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q
```

Expected: all passing.

**Step 5: Commit**

```bash
git add frontend/src/views/Settings.tsx
git commit -m "feat: chronotype + wake time settings with circadian energy defaults"
```

---

## Summary

After all tasks complete:

1. User opens Settings → sets wake time (e.g. 07:00) + chronotype
2. Clicks "Apply to energy profile" → energy grid is pre-populated with science-based curve
3. Eden's scheduler places deep work (load=3) in the 5-energy slots (hours 9–11 for a 7am waker)
4. LLM context includes `user_profile` so Eden can reason: "Your peak window is 9–11am — that's where task X belongs"
5. User can still manually override any cell in the energy grid after applying defaults
