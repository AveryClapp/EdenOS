# Eden Extensions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement explainability layer, multi-objective scheduling, hierarchical goal inference, and RL data collection infrastructure.

**Architecture:** Four independent features wired into the existing scheduler pipeline. Explainability and goal inference run as post-scheduler background tasks. Multi-objective changes are confined to the CP-SAT engine. RL collection instruments the scheduler and task completion path. All features use TDD.

**Tech Stack:** FastAPI, SQLAlchemy, OR-Tools CP-SAT, Anthropic SDK (claude-opus-4-6), React/TypeScript, Alembic

**Test command:** `source .venv/bin/activate && pytest tests/ -v`
**Type check:** `cd frontend && npx tsc --noEmit`

---

## Task 1: Schema migration + new models

**Files:**
- Create: `alembic/versions/e5f6a7b8c9d0_extensions.py`
- Modify: `backend/models/schedule_block.py`
- Create: `backend/models/plan_explanation.py`
- Create: `backend/models/rl_episode.py`
- Modify: `backend/models/__init__.py`

**Step 1: Write the migration**

```python
# alembic/versions/e5f6a7b8c9d0_extensions.py
"""extensions

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-03
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e5f6a7b8c9d0'
down_revision: Union[str, Sequence[str], None] = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column('schedule_blocks', sa.Column('reasoning', sa.Text(), nullable=True))

    op.create_table(
        'plan_explanations',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('date', sa.Date(), nullable=False),
        sa.Column('summary', sa.Text(), nullable=False),
        sa.Column('full_reasoning', sa.Text(), nullable=False),  # JSON string
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'rl_episodes',
        sa.Column('id', sa.String(36), nullable=False),
        sa.Column('scheduled_at', sa.DateTime(), nullable=False),
        sa.Column('state', sa.Text(), nullable=False),   # JSON string
        sa.Column('action', sa.Text(), nullable=False),  # JSON string
        sa.Column('reward', sa.Float(), nullable=True),
        sa.Column('reward_computed_at', sa.DateTime(), nullable=True),
        sa.Column('episode_complete', sa.Boolean(), nullable=False, server_default='0'),
        sa.PrimaryKeyConstraint('id'),
    )


def downgrade() -> None:
    op.drop_table('rl_episodes')
    op.drop_table('plan_explanations')
    op.drop_column('schedule_blocks', 'reasoning')
```

**Step 2: Add `reasoning` to the ScheduleBlock model**

In `backend/models/schedule_block.py`, add after the `label` line:
```python
reasoning: Mapped[str | None] = mapped_column(Text(), nullable=True)
```
Also add `Text` to the sqlalchemy import.

**Step 3: Create `backend/models/plan_explanation.py`**

```python
import uuid
from datetime import datetime, date
from sqlalchemy import String, Date, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class PlanExplanation(Base):
    __tablename__ = "plan_explanations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    full_reasoning: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
```

**Step 4: Create `backend/models/rl_episode.py`**

```python
import uuid
from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class RLEpisode(Base):
    __tablename__ = "rl_episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)   # JSON
    action: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    reward: Mapped[float | None] = mapped_column(Float, nullable=True)
    reward_computed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    episode_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

**Step 5: Register new models in `backend/models/__init__.py`**

Add imports and export entries:
```python
from backend.models.plan_explanation import PlanExplanation
from backend.models.rl_episode import RLEpisode
```
Add `"PlanExplanation"` and `"RLEpisode"` to `__all__`.

**Step 6: Run migration**

```bash
source .venv/bin/activate && alembic upgrade head
```
Expected: no errors, `e5f6a7b8c9d0 (head)` from `alembic current`

**Step 7: Run tests to confirm nothing broken**

```bash
source .venv/bin/activate && pytest tests/ -q
```
Expected: all existing tests pass

**Step 8: Commit**

```bash
git add alembic/versions/e5f6a7b8c9d0_extensions.py \
    backend/models/schedule_block.py \
    backend/models/plan_explanation.py \
    backend/models/rl_episode.py \
    backend/models/__init__.py
git commit -m "feat: schema for explainability (plan_explanations, schedule_blocks.reasoning) and RL episodes"
```

---

## Task 2: Explainability — intelligence layer

**Files:**
- Modify: `backend/intelligence/prompts.py`
- Create: `backend/intelligence/explainer.py`
- Create: `tests/intelligence/test_explainer.py`

**Step 1: Add prompt to `backend/intelligence/prompts.py`**

Append to the bottom of the file:
```python
EXPLAINER_SYSTEM_PROMPT = """You are Eden's schedule explainer.

Given a day's schedule with task details, energy levels, and urgency scores,
produce a JSON object with two fields:
1. "summary": one paragraph narrating the key scheduling decisions for the day
2. "block_reasoning": object mapping each task_id to a one-sentence explanation
   of why it was placed at that time (cite energy level, urgency, or dependency)

Respond ONLY with valid JSON. No markdown fences.
Example:
{
  "summary": "Deep work on research (load 3) lands at 9am where energy is 5...",
  "block_reasoning": {
    "task-uuid-1": "Placed at 9am — energy 5, urgency 3.2, highest-priority deep work slot.",
    "task-uuid-2": "Placed at 2pm — load 1 admin fits the post-lunch energy dip (energy 2)."
  }
}
"""


def format_explainer_prompt(schedule_blocks: list[dict], task_map: dict[str, dict]) -> str:
    """Build the user prompt for schedule explanation."""
    import json
    blocks_with_context = []
    for b in schedule_blocks:
        task = task_map.get(b.get("task_id") or "")
        blocks_with_context.append({
            "task_id": b.get("task_id"),
            "task_title": task["title"] if task else b.get("label") or "Blocked",
            "cognitive_load": task["cognitive_load"] if task else None,
            "urgency": task.get("urgency") if task else None,
            "start_time": b["start_time"],
            "end_time": b["end_time"],
            "energy_at_slot": b.get("energy_at_slot"),
        })
    return json.dumps(blocks_with_context, default=str)
```

**Step 2: Write failing test**

```python
# tests/intelligence/test_explainer.py
from unittest.mock import MagicMock, patch
from backend.intelligence.explainer import generate_schedule_explanation


def test_generate_explanation_returns_summary_and_block_reasoning():
    blocks = [
        {"task_id": "t1", "start_time": "09:00:00", "end_time": "10:00:00", "label": None},
        {"task_id": "t2", "start_time": "14:00:00", "end_time": "15:00:00", "label": None},
    ]
    task_map = {
        "t1": {"title": "Write paper", "cognitive_load": 3, "urgency": 3.5},
        "t2": {"title": "Review PR", "cognitive_load": 1, "urgency": 1.1},
    }
    mock_response = MagicMock()
    mock_response.content = [MagicMock(type="text", text='{"summary": "Deep work first.", "block_reasoning": {"t1": "High energy.", "t2": "Low load."}}')]

    with patch("backend.intelligence.explainer.anthropic.Anthropic") as MockAnth:
        MockAnth.return_value.messages.create.return_value = mock_response
        result = generate_schedule_explanation(blocks, task_map)

    assert "summary" in result
    assert "block_reasoning" in result
    assert result["summary"] == "Deep work first."
    assert result["block_reasoning"]["t1"] == "High energy."


def test_generate_explanation_handles_json_parse_error():
    blocks = [{"task_id": "t1", "start_time": "09:00:00", "end_time": "10:00:00", "label": None}]
    task_map = {"t1": {"title": "T", "cognitive_load": 2, "urgency": 1.0}}
    mock_response = MagicMock()
    mock_response.content = [MagicMock(type="text", text="not json")]

    with patch("backend.intelligence.explainer.anthropic.Anthropic") as MockAnth:
        MockAnth.return_value.messages.create.return_value = mock_response
        result = generate_schedule_explanation(blocks, task_map)

    assert result["summary"] == ""
    assert result["block_reasoning"] == {}
```

**Step 3: Run test to verify it fails**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_explainer.py -v
```
Expected: `ImportError` — module doesn't exist yet

**Step 4: Create `backend/intelligence/explainer.py`**

```python
import json
import anthropic

from backend.config import settings
from backend.intelligence.prompts import EXPLAINER_SYSTEM_PROMPT, format_explainer_prompt


def generate_schedule_explanation(
    schedule_blocks: list[dict],
    task_map: dict[str, dict],
) -> dict:
    """
    Call Claude to explain today's scheduling decisions.
    Returns {"summary": str, "block_reasoning": {task_id: str}}.
    Falls back to empty result on any error.
    """
    if not schedule_blocks:
        return {"summary": "", "block_reasoning": {}}

    client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
    prompt = format_explainer_prompt(schedule_blocks, task_map)

    try:
        response = client.messages.create(
            model=settings.llm_model,
            max_tokens=1024,
            system=EXPLAINER_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = response.content[0].text.strip()
        parsed = json.loads(raw)
        return {
            "summary": parsed.get("summary", ""),
            "block_reasoning": parsed.get("block_reasoning", {}),
        }
    except Exception:
        return {"summary": "", "block_reasoning": {}}
```

**Step 5: Run tests to verify they pass**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_explainer.py -v
```
Expected: 2 PASSED

**Step 6: Commit**

```bash
git add backend/intelligence/prompts.py backend/intelligence/explainer.py tests/intelligence/test_explainer.py
git commit -m "feat: schedule explainer — Claude narrates daily scheduling decisions"
```

---

## Task 3: Explainability — API endpoint + scheduler hook

**Files:**
- Modify: `backend/api/schedule.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/api/schedule.ts`
- Test: `tests/api/test_schedule.py`

**Step 1: Write failing test**

Add to `tests/api/test_schedule.py`:
```python
from unittest.mock import patch


def test_get_explanation_returns_structure(client):
    from datetime import date
    r = client.get(f"/api/schedule/explanation?date={date.today().isoformat()}")
    assert r.status_code == 200
    data = r.json()
    assert "summary" in data
    assert "block_reasoning" in data


def test_explanation_stored_after_scheduler_run(client):
    from unittest.mock import patch
    _setup(client)
    mock_explanation = {"summary": "Test summary.", "block_reasoning": {}}
    with patch("backend.api.schedule.generate_schedule_explanation", return_value=mock_explanation):
        client.post("/api/schedule/run")
    from datetime import date
    r = client.get(f"/api/schedule/explanation?date={date.today().isoformat()}")
    assert r.status_code == 200
```

**Step 2: Run to verify failure**

```bash
source .venv/bin/activate && pytest tests/api/test_schedule.py::test_get_explanation_returns_structure -v
```
Expected: 404 — endpoint doesn't exist

**Step 3: Update `backend/api/schedule.py`**

Add imports at the top:
```python
from backend.intelligence.explainer import generate_schedule_explanation
from backend.models.plan_explanation import PlanExplanation
```

In `_run_scheduler_job`, after `db.commit()` and before `return`, add:
```python
    # Generate schedule explanation as background-style work (best-effort)
    try:
        today_blocks = [b for b in results if b.date == start_date]
        task_ids = [b.task_id for b in today_blocks if b.task_id]
        task_objs = {t.id: {"title": t.title, "cognitive_load": t.cognitive_load, "urgency": None}
                     for t in tasks if t.id in task_ids}
        blocks_for_explain = [
            {"task_id": b.task_id, "start_time": str(b.start_time),
             "end_time": str(b.end_time), "label": None}
            for b in today_blocks
        ]
        explanation = generate_schedule_explanation(blocks_for_explain, task_objs)
        existing = db.query(PlanExplanation).filter(PlanExplanation.date == start_date).first()
        if existing:
            existing.summary = explanation["summary"]
            existing.full_reasoning = __import__('json').dumps(explanation["block_reasoning"])
        else:
            db.add(PlanExplanation(
                id=str(uuid.uuid4()),
                date=start_date,
                summary=explanation["summary"],
                full_reasoning=__import__('json').dumps(explanation["block_reasoning"]),
                created_at=datetime.utcnow(),
            ))
        db.commit()
    except Exception:
        pass  # Explanation is best-effort — never fail the scheduler
```

Add the endpoint (after `run_scheduler` route):
```python
@router.get("/explanation")
def get_explanation(date: date = Query(default=None), db: Session = Depends(get_db)):
    target = date or __import__('datetime').date.today()
    row = db.query(PlanExplanation).filter(PlanExplanation.date == target).first()
    if not row:
        return {"summary": "", "block_reasoning": {}}
    import json
    return {
        "summary": row.summary,
        "block_reasoning": json.loads(row.full_reasoning or "{}"),
    }
```

**Step 4: Run tests**

```bash
source .venv/bin/activate && pytest tests/api/test_schedule.py -v
```
Expected: all pass

**Step 5: Add frontend types and API call**

In `frontend/src/types.ts` append:
```typescript
export interface ScheduleExplanation {
  summary: string
  block_reasoning: Record<string, string>
}
```

In `frontend/src/api/schedule.ts` append:
```typescript
import type { ScheduleResponse, ScheduleRunResult, PlanDayResult, ScheduleExplanation } from '../types'

export const getExplanation = (date?: string) =>
  apiFetch<ScheduleExplanation>(date ? `/schedule/explanation?date=${date}` : '/schedule/explanation')
```

**Step 6: Type check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

**Step 7: Commit**

```bash
git add backend/api/schedule.py frontend/src/types.ts frontend/src/api/schedule.ts tests/api/test_schedule.py
git commit -m "feat: explainability API — GET /schedule/explanation, stored after each scheduler run"
```

---

## Task 4: Explainability — Frontend strip

**Files:**
- Modify: `frontend/src/views/Today.tsx`

**Step 1: Add "Why this schedule?" collapsible strip**

In `frontend/src/views/Today.tsx`, add import:
```typescript
import { getExplanation } from '../api/schedule'
import type { ScheduleExplanation } from '../types'
```

Add query inside the `Today` component (alongside existing queries):
```typescript
const { data: explanation } = useQuery({
  queryKey: ['schedule-explanation'],
  queryFn: getExplanation,
  refetchInterval: 60_000,
})
```

Add a `WhyStrip` component above the `TimeGrid` section, inside the scrollable div:
```tsx
{explanation?.summary && (
  <WhyStrip explanation={explanation} />
)}
<TimeGrid ... />
```

Add the `WhyStrip` component definition (above `Today`):
```tsx
function WhyStrip({ explanation }: { explanation: ScheduleExplanation }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid #1e1710' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 24px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10, color: '#4a3f30' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 11, color: '#6b5a47' }}>Why this schedule?</span>
      </button>
      {open && (
        <div style={{ padding: '0 24px 12px', fontSize: 12, color: '#a89070', lineHeight: 1.6 }}>
          {explanation.summary}
        </div>
      )}
    </div>
  )
}
```

**Step 2: Type check**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

**Step 3: Commit**

```bash
git add frontend/src/views/Today.tsx
git commit -m "feat: 'Why this schedule?' collapsible strip in Today view"
```

---

## Task 5: Multi-objective optimization — context switching penalty

**Files:**
- Modify: `backend/scheduler/decay.py`
- Modify: `backend/scheduler/engine.py`
- Test: `tests/scheduler/test_engine.py`

**Step 1: Add weight constants to `backend/scheduler/decay.py`**

Append after existing constants:
```python
# --- Soft constraint weights (all objective weights configurable here) ---
WEIGHT_URGENCY_ENERGY: float = 1.0        # Weight for urgency × energy fit term
WEIGHT_FOCUS_QUALITY: float = 0.5         # Extra penalty for deep-focus in low-energy slot
WEIGHT_CONTEXT_SWITCH: float = 0.3        # Penalty per adjacent-block project switch
FOCUS_ENERGY_THRESHOLD: int = 3           # Energy level below which deep-focus is penalized
```

**Step 2: Write failing tests**

Add to `tests/scheduler/test_engine.py`:
```python
def test_objective_weights_are_configurable():
    """Weights must live in decay.py, not engine.py."""
    import backend.scheduler.decay as decay
    assert hasattr(decay, 'WEIGHT_URGENCY_ENERGY')
    assert hasattr(decay, 'WEIGHT_FOCUS_QUALITY')
    assert hasattr(decay, 'WEIGHT_CONTEXT_SWITCH')


def test_context_switch_penalty_constant_exists():
    from backend.scheduler.decay import WEIGHT_CONTEXT_SWITCH
    assert WEIGHT_CONTEXT_SWITCH > 0
```

**Step 3: Run to verify pass** (these tests just check constants exist — they should pass after step 1)

```bash
source .venv/bin/activate && pytest tests/scheduler/test_engine.py::test_objective_weights_are_configurable tests/scheduler/test_engine.py::test_context_switch_penalty_constant_exists -v
```
Expected: PASSED

**Step 4: Update `backend/scheduler/engine.py` to use new weights and add context switching penalty**

Add import at top:
```python
from backend.scheduler.decay import compute_urgency, WEIGHT_URGENCY_ENERGY, WEIGHT_FOCUS_QUALITY, WEIGHT_CONTEXT_SWITCH, FOCUS_ENERGY_THRESHOLD
```

Replace the existing soft objective block (lines 150–161) with:
```python
        # Soft objective: urgency × energy fit + focus quality + context switching penalty
        obj_terms = []

        # Term 1: urgency × energy (weighted by WEIGHT_URGENCY_ENERGY)
        for t, task in enumerate(schedulable):
            urgency = urgency_scores[t]
            for s, slot in enumerate(slots):
                energy = energy_map.get(slot.absolute_index, 3)
                if task.cognitive_load == 3:
                    base = urgency * energy
                else:
                    base = urgency
                weight = int(base * WEIGHT_URGENCY_ENERGY * SCORE_SCALE / SCORE_SCALE)
                if weight > 0:
                    obj_terms.append(weight * x[t][s])

        # Term 2: focus quality — penalize deep-focus tasks in low-energy slots
        focus_penalty_scale = int(WEIGHT_FOCUS_QUALITY * SCORE_SCALE)
        for t, task in enumerate(schedulable):
            if task.cognitive_load == 3:
                for s, slot in enumerate(slots):
                    energy = energy_map.get(slot.absolute_index, 3)
                    if energy < FOCUS_ENERGY_THRESHOLD:
                        obj_terms.append(-focus_penalty_scale * x[t][s])

        # Term 3: context switching — penalize adjacent slots assigned to different projects
        # Build project_id per task index
        project_ids = [getattr(t, 'project_id', None) for t in schedulable]
        switch_penalty_scale = int(WEIGHT_CONTEXT_SWITCH * SCORE_SCALE)
        for s in range(n_slots - 1):
            for t1 in range(n_tasks):
                for t2 in range(n_tasks):
                    if t1 != t2 and project_ids[t1] != project_ids[t2]:
                        switch_var = model.NewBoolVar(f"sw_{t1}_{t2}_{s}")
                        model.AddBoolAnd([x[t1][s], x[t2][s + 1]]).OnlyEnforceIf(switch_var)
                        model.AddBoolOr([x[t1][s].Not(), x[t2][s + 1].Not()]).OnlyEnforceIf(switch_var.Not())
                        obj_terms.append(-switch_penalty_scale * switch_var)

        if obj_terms:
            model.Maximize(sum(obj_terms))
```

**Step 5: Run full test suite**

```bash
source .venv/bin/activate && pytest tests/ -q
```
Expected: all pass (the context switching logic only affects the objective, not hard constraints)

**Step 6: Commit**

```bash
git add backend/scheduler/decay.py backend/scheduler/engine.py tests/scheduler/test_engine.py
git commit -m "feat: multi-objective scheduling — focus quality + context switching penalties, configurable weights in decay.py"
```

---

## Task 6: Hierarchical goal inference

**Files:**
- Create: `backend/intelligence/goal_inference.py`
- Create: `tests/intelligence/test_goal_inference.py`
- Modify: `backend/api/schedule.py`

**Step 1: Write failing test**

```python
# tests/intelligence/test_goal_inference.py
from unittest.mock import patch, MagicMock


def _make_db_with_thin_goal():
    """Return a mock DB session with one active goal that has 1 open task."""
    from unittest.mock import MagicMock
    goal = MagicMock()
    goal.id = "goal-1"
    goal.title = "Learn Rust"
    goal.status = "active"
    goal.tier = "long"

    project = MagicMock()
    project.id = "proj-1"
    project.goal_id = "goal-1"
    project.status = "active"
    project.title = "Rust exercises"

    task = MagicMock()
    task.status = "active"
    task.project_id = "proj-1"

    db = MagicMock()
    db.query.return_value.filter.return_value.all.side_effect = [
        [goal],      # goals query
        [project],   # projects query
        [task],      # tasks query
    ]
    return db, goal, project


def test_thin_goal_triggers_inference():
    from backend.intelligence.goal_inference import check_goal_coverage
    db, goal, project = _make_db_with_thin_goal()

    mock_response = MagicMock()
    mock_response.content = [MagicMock(type="text", text='[{"title": "Read Rust book ch.1", "cognitive_load": 2, "estimated_minutes": 60, "project_id": "proj-1"}]')]

    with patch("backend.intelligence.goal_inference.anthropic.Anthropic") as MockAnth:
        MockAnth.return_value.messages.create.return_value = mock_response
        proposals = check_goal_coverage(db)

    assert len(proposals) >= 1
    assert proposals[0]["title"] == "Read Rust book ch.1"


def test_well_covered_goal_skips_inference():
    from backend.intelligence.goal_inference import check_goal_coverage
    from unittest.mock import MagicMock

    goal = MagicMock()
    goal.id = "goal-1"
    goal.status = "active"

    project = MagicMock()
    project.id = "proj-1"
    project.goal_id = "goal-1"
    project.status = "active"

    tasks = [MagicMock(status="active", project_id="proj-1") for _ in range(4)]

    db = MagicMock()
    db.query.return_value.filter.return_value.all.side_effect = [
        [goal], [project], tasks,
    ]

    with patch("backend.intelligence.goal_inference.anthropic.Anthropic") as MockAnth:
        proposals = check_goal_coverage(db)
        MockAnth.return_value.messages.create.assert_not_called()

    assert proposals == []
```

**Step 2: Run to verify failure**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_goal_inference.py -v
```
Expected: ImportError

**Step 3: Create `backend/intelligence/goal_inference.py`**

```python
import json
import anthropic
from sqlalchemy.orm import Session

from backend.config import settings
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task

GOAL_COVERAGE_THRESHOLD = 3  # Goals with fewer open tasks than this are "thin"

INFERENCE_SYSTEM_PROMPT = """You are Eden's goal planner.

Given a goal and its current open tasks, propose 3-5 concrete next tasks that would
move this goal forward. Each task should be actionable within a single work session.

Respond ONLY with a JSON array. Each element:
{"title": str, "cognitive_load": 1|2|3, "estimated_minutes": int, "project_id": str}

No markdown. No explanation. Just the JSON array.
"""


def check_goal_coverage(db: Session) -> list[dict]:
    """
    Check all active goals for thin task coverage.
    Returns a list of proposed task dicts for thin goals.
    All proposals use existing project_ids — no new projects created.
    """
    goals = db.query(Goal).filter(Goal.status == "active").all()
    if not goals:
        return []

    projects = db.query(Project).filter(Project.status == "active").all()
    project_by_goal: dict[str, list] = {}
    for p in projects:
        project_by_goal.setdefault(p.goal_id, []).append(p)

    all_tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()
    tasks_by_project: dict[str, list] = {}
    for t in all_tasks:
        tasks_by_project.setdefault(t.project_id, []).append(t)

    proposals = []

    for goal in goals:
        goal_projects = project_by_goal.get(goal.id, [])
        if not goal_projects:
            continue
        open_tasks = []
        for p in goal_projects:
            open_tasks.extend(tasks_by_project.get(p.id, []))

        if len(open_tasks) >= GOAL_COVERAGE_THRESHOLD:
            continue

        # Goal is thin — ask Claude for new tasks
        project = goal_projects[0]  # Target first active project
        try:
            client = anthropic.Anthropic(api_key=settings.anthropic_api_key)
            prompt = (
                f"Goal: {goal.title} (tier: {goal.tier})\n"
                f"Project: {project.title} (id: {project.id})\n"
                f"Current open tasks: {[t.title for t in open_tasks]}\n\n"
                f"Propose 3-5 concrete next tasks."
            )
            response = client.messages.create(
                model=settings.llm_model,
                max_tokens=512,
                system=INFERENCE_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            task_list = json.loads(raw)
            for t in task_list:
                if "title" in t and "project_id" in t:
                    proposals.append(t)
        except Exception:
            continue

    return proposals
```

**Step 4: Run tests**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_goal_inference.py -v
```
Expected: 2 PASSED

**Step 5: Hook into `_run_scheduler_job` in `backend/api/schedule.py`**

Add import:
```python
from backend.intelligence.goal_inference import check_goal_coverage
```

At end of `_run_scheduler_job` (after explanation block, before `return`):
```python
    # Goal coverage check — propose tasks for thin goals (best-effort)
    try:
        _goal_proposals_cache.clear()
        proposals = check_goal_coverage(db)
        _goal_proposals_cache.extend(proposals)
    except Exception:
        pass
```

Add module-level cache before the router (this is a simple in-memory store for the proposals until we have a proper alert pipeline):
```python
_goal_proposals_cache: list[dict] = []
```

Add endpoint to expose proposals:
```python
@router.get("/goal-proposals")
def get_goal_proposals():
    """Return inferred task proposals for thin goals."""
    return {"proposals": _goal_proposals_cache}
```

**Step 6: Run all tests**

```bash
source .venv/bin/activate && pytest tests/ -q
```
Expected: all pass

**Step 7: Commit**

```bash
git add backend/intelligence/goal_inference.py backend/api/schedule.py tests/intelligence/test_goal_inference.py
git commit -m "feat: hierarchical goal inference — detect thin goals and propose tasks via Claude"
```

---

## Task 7: RL data collection infrastructure

**Files:**
- Create: `backend/intelligence/rl_collector.py`
- Create: `tests/intelligence/test_rl_collector.py`
- Modify: `backend/api/schedule.py`
- Modify: `backend/main.py`

**Step 1: Write failing tests**

```python
# tests/intelligence/test_rl_collector.py
from datetime import datetime, timedelta
from tests.conftest import override_get_db
from backend.db import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import backend.models  # noqa


def _make_db():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def test_record_episode_stores_state_and_action():
    from backend.intelligence.rl_collector import record_episode
    from backend.models.rl_episode import RLEpisode
    db = _make_db()

    schedule_results = [
        {"task_id": "t1", "date": "2026-03-03", "start_time": "09:00", "end_time": "10:00"},
    ]
    state = {"tasks": [{"id": "t1", "cognitive_load": 2, "urgency": 1.5}]}

    record_episode(schedule_results, state, db)

    episodes = db.query(RLEpisode).all()
    assert len(episodes) == 1
    assert episodes[0].episode_complete is False
    assert episodes[0].reward is None
    import json
    action = json.loads(episodes[0].action)
    assert action[0]["task_id"] == "t1"


def test_compute_rewards_marks_complete_episodes():
    from backend.intelligence.rl_collector import record_episode, compute_rewards
    from backend.models.rl_episode import RLEpisode
    from backend.models.task import Task
    from backend.models.learning_record import LearningRecord
    import json

    db = _make_db()

    # Create a task
    from backend.models.goal import Goal
    from backend.models.project import Project
    g = Goal(id="g1", title="G", tier="long", weight=1.0,
             target_date=datetime(2027, 1, 1).date(), status="active", created_at=datetime.utcnow())
    p = Project(id="p1", title="P", category="engineering", goal_id="g1",
                priority_score=0.0, status="active", estimated_hours_remaining=10.0)
    t = Task(id="t1", project_id="p1", title="T", cognitive_load=2,
             estimated_minutes=60, source="manual", status="done", created_at=datetime.utcnow())
    db.add_all([g, p, t])

    # Create a learning record for this task
    lr = LearningRecord(id="lr1", task_id="t1", estimated_minutes=60, actual_minutes=55,
                        energy_level_at_start=3, completion_quality=4,
                        recorded_at=datetime.utcnow())
    db.add(lr)
    db.commit()

    # Record an episode referencing this task
    record_episode([{"task_id": "t1", "date": "2026-03-03", "start_time": "09:00", "end_time": "10:00"}],
                   {"tasks": []}, db)

    compute_rewards(db)

    episode = db.query(RLEpisode).first()
    assert episode.episode_complete is True
    assert episode.reward is not None


def test_reward_is_bounded():
    from backend.intelligence.rl_collector import _compute_single_reward
    reward = _compute_single_reward(completion_quality=5, estimated_minutes=60,
                                    actual_minutes=60, deadline=None, now=datetime.utcnow())
    assert -1.0 <= reward <= 1.0
```

**Step 2: Run to verify failure**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_rl_collector.py -v
```
Expected: ImportError

**Step 3: Create `backend/intelligence/rl_collector.py`**

```python
"""
RL data collection infrastructure.

Records scheduling decisions as (state, action) pairs and computes rewards
lazily once tasks complete. This corpus trains future RL agents to replace
hand-tuned soft constraint weights.

Reward formula (normalized to [-1, 1]):
  +completion_quality / 5          (quality of work, 0.0–1.0)
  +0.3 if |actual - estimated| / estimated < 0.2  (accurate estimation)
  -0.5 if task completed past deadline
  Clamped to [-1, 1]
"""
import json
import uuid
from datetime import datetime
from sqlalchemy.orm import Session

from backend.models.rl_episode import RLEpisode
from backend.models.task import Task
from backend.models.learning_record import LearningRecord


def record_episode(
    schedule_results: list[dict],
    state: dict,
    db: Session,
) -> None:
    """Store a new episode at scheduling time. Reward computed later."""
    episode = RLEpisode(
        id=str(uuid.uuid4()),
        scheduled_at=datetime.utcnow(),
        state=json.dumps(state, default=str),
        action=json.dumps(schedule_results, default=str),
        reward=None,
        reward_computed_at=None,
        episode_complete=False,
    )
    db.add(episode)
    db.commit()


def _compute_single_reward(
    completion_quality: int,
    estimated_minutes: int,
    actual_minutes: int,
    deadline: datetime | None,
    now: datetime,
) -> float:
    reward = completion_quality / 5.0
    if estimated_minutes > 0:
        ratio = abs(actual_minutes - estimated_minutes) / estimated_minutes
        if ratio < 0.2:
            reward += 0.3
    if deadline and now > deadline:
        reward -= 0.5
    return max(-1.0, min(1.0, reward))


def compute_rewards(db: Session) -> int:
    """
    Scan incomplete episodes and close them if all their tasks have learning records.
    Returns the number of episodes closed.
    """
    incomplete = db.query(RLEpisode).filter(RLEpisode.episode_complete == False).all()
    closed = 0
    now = datetime.utcnow()

    for episode in incomplete:
        try:
            action = json.loads(episode.action)
            task_ids = [a["task_id"] for a in action if a.get("task_id")]
            if not task_ids:
                episode.episode_complete = True
                continue

            tasks = db.query(Task).filter(Task.id.in_(task_ids)).all()
            task_map = {t.id: t for t in tasks}

            # Check if all tasks are resolved (done or past deadline)
            all_resolved = all(
                t.status == "done" or (t.deadline and now > t.deadline)
                for t in tasks
            )
            if not all_resolved:
                continue

            # Compute aggregate reward across all tasks in this episode
            rewards = []
            for t in tasks:
                lr = db.query(LearningRecord).filter(
                    LearningRecord.task_id == t.id
                ).order_by(LearningRecord.recorded_at.desc()).first()
                if lr:
                    r = _compute_single_reward(
                        completion_quality=lr.completion_quality,
                        estimated_minutes=lr.estimated_minutes,
                        actual_minutes=lr.actual_minutes,
                        deadline=t.deadline,
                        now=now,
                    )
                    rewards.append(r)

            if rewards:
                episode.reward = sum(rewards) / len(rewards)
            episode.reward_computed_at = now
            episode.episode_complete = True
            closed += 1
        except Exception:
            continue

    db.commit()
    return closed
```

**Step 4: Run tests**

```bash
source .venv/bin/activate && pytest tests/intelligence/test_rl_collector.py -v
```
Expected: 3 PASSED

**Step 5: Hook `record_episode` into `_run_scheduler_job` in `backend/api/schedule.py`**

Add import:
```python
from backend.intelligence.rl_collector import record_episode, compute_rewards
```

At end of `_run_scheduler_job` (after goal proposals block, before `return`):
```python
    # RL episode recording (best-effort)
    try:
        rl_state = {
            "tasks": [
                {"id": t.id, "cognitive_load": t.cognitive_load,
                 "urgency": compute_urgency(1.0, t.deadline, t.created_at, now=now),
                 "estimated_minutes": t.estimated_minutes}
                for t in tasks
            ],
            "day_of_week": start_date.weekday(),
        }
        rl_action = [
            {"task_id": r.task_id, "date": str(r.date),
             "start_time": str(r.start_time), "end_time": str(r.end_time)}
            for r in results
        ]
        record_episode(rl_action, rl_state, db)
    except Exception:
        pass
```

**Step 6: Add `compute_rewards` to background loop in `backend/main.py`**

Replace `_scheduler_loop` with:
```python
async def _scheduler_loop() -> None:
    """Background task: re-run the scheduler and compute RL rewards every interval."""
    while True:
        await asyncio.sleep(settings.scheduler_interval_seconds)
        db = SessionLocal()
        try:
            _run_scheduler_job(db)
        except Exception as exc:
            print(f"[scheduler] background run failed: {exc}")
        finally:
            db.close()

        db = SessionLocal()
        try:
            from backend.intelligence.rl_collector import compute_rewards
            closed = compute_rewards(db)
            if closed:
                print(f"[rl] closed {closed} episode(s)")
        except Exception as exc:
            print(f"[rl] reward computation failed: {exc}")
        finally:
            db.close()
```

**Step 7: Run full test suite**

```bash
source .venv/bin/activate && pytest tests/ -q
```
Expected: all pass (194+ tests)

**Step 8: Type check frontend**

```bash
cd frontend && npx tsc --noEmit
```
Expected: no errors

**Step 9: Commit**

```bash
git add backend/intelligence/rl_collector.py backend/api/schedule.py backend/main.py tests/intelligence/test_rl_collector.py
git commit -m "feat: RL data collection — record episodes at schedule time, compute rewards on task completion"
```

---

## Final verification

```bash
source .venv/bin/activate && pytest tests/ -v
cd frontend && npx tsc --noEmit
```

All tests green. Commit count: +7 commits from this feature branch.
