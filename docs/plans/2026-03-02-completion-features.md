# Completion Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add four finishing features: a focus timer in NowStrip that auto-captures learning data, urgency scores in the task API with visual decay indicators, a global quick-add shortcut for natural-language task creation, and a weekly planning view.

**Architecture:** Three frontend-only tasks (focus timer, quick-add, urgency viz) and one full-stack task (weekly planning). No new DB migrations — urgency is computed at read time, weekly planning reuses existing `ScheduleBlock` with `is_draft`. Task 2 (urgency) touches backend first; Tasks 1, 3, 4 are independent of each other.

**Tech Stack:** FastAPI, Pydantic v2, SQLAlchemy, React, TypeScript, TanStack Query, Tailwind v4.

---

## Background: Key Files

Read before implementing:
- `backend/api/schemas.py` — `TaskResponse` model_validator pattern, how to add computed fields
- `backend/scheduler/decay.py` — `compute_urgency(base_priority, deadline, created_at)` signature
- `frontend/src/views/Today.tsx` — `CompleteForm` component + `NowStrip` component (lines ~1–200)
- `frontend/src/views/Projects.tsx` — `TaskRow` component for urgency badge placement
- `frontend/src/api/chat.ts` — `sendMessage` for QuickAdd, needs `executeActions` added
- `backend/api/plan.py` — plan generation logic to extract into a helper for weekly

---

## Task 1: Focus Timer in NowStrip

When `[ on it ]` is clicked, start a running timer. `[ stop & log ]` pre-fills the completion form with elapsed minutes. Closes the feedback loop for learning records without extra clicks.

**Files:**
- Modify: `frontend/src/views/Today.tsx`

**Step 1: Add `formatElapsed` helper**

In `Today.tsx`, after the existing `fmtTime` function, add:

```typescript
function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}
```

**Step 2: Add `defaultMins` prop to `CompleteForm`**

Read the existing `CompleteForm` component. Change its props interface and `mins` initial state:

```typescript
function CompleteForm({
  task,
  onDone,
  defaultMins,
}: {
  task: Task
  onDone: () => void
  defaultMins?: number
}) {
  const [mins, setMins] = useState(String(defaultMins ?? task.estimated_minutes))
  // rest unchanged
```

**Step 3: Rewrite `NowStrip` with timer logic**

Replace the existing `NowStrip` function entirely:

```typescript
function NowStrip() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['now'],
    queryFn: getNowSuggestion,
    refetchInterval: 60_000,
  })

  const [skips, setSkips] = useState(0)
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)
  const [timerStart, setTimerStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    if (!timerStart) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - timerStart) / 1000)), 1000)
    return () => clearInterval(id)
  }, [timerStart])

  const now = Date.now()
  const isSnoozed = snoozedUntil !== null && now < snoozedUntil

  if (isLoading || isSnoozed) return null
  if (!data?.task) return null

  const handleOnIt = () => {
    setTimerStart(Date.now())
    setElapsed(0)
  }

  const handleSkip = () => {
    setSkips(s => s + 1)
    setTimerStart(null)
    qc.invalidateQueries({ queryKey: ['now'] })
  }

  const handleNotNow = () => {
    setTimerStart(null)
    setSnoozedUntil(Date.now() + 20 * 60 * 1000)
  }

  const elapsedMins = Math.max(1, Math.ceil(elapsed / 60))

  if (timerStart) {
    return (
      <div className="border-b border-zinc-800">
        <div className="px-6 py-3 flex items-center gap-4 text-xs">
          <button
            onClick={() => setShowLog(true)}
            className="text-emerald-500 hover:text-emerald-400 shrink-0 transition-colors"
          >
            [ stop & log ]
          </button>
          <span className="text-zinc-200 flex-1 truncate">{data.task.title}</span>
          <span className="text-zinc-500 font-mono shrink-0">{formatElapsed(elapsed)}</span>
          <button onClick={handleSkip} className="text-zinc-600 hover:text-zinc-400 shrink-0 transition-colors">
            [ abandon ]
          </button>
        </div>
        {showLog && (
          <CompleteForm
            task={data.task as Task}
            defaultMins={elapsedMins}
            onDone={() => {
              setTimerStart(null)
              setElapsed(0)
              setShowLog(false)
              qc.invalidateQueries({ queryKey: ['now'] })
              qc.invalidateQueries({ queryKey: ['tasks'] })
              qc.invalidateQueries({ queryKey: ['schedule'] })
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="border-b border-zinc-800 px-6 py-3 flex items-center gap-4 text-xs">
      <button
        onClick={handleOnIt}
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

Note: `data.task as Task` is needed because `NowSuggestion.task` is typed `Task | null` and we've already checked it's non-null above.

**Step 4: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 5: Run backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q 2>&1 | tail -3
```

Expected: 190 passed.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/views/Today.tsx
git commit -m "feat: focus timer in NowStrip — auto-captures actual_minutes for learning records"
```

---

## Task 2: Urgency Score in Task API + Visual Indicator

Add a computed `urgency` field to `TaskResponse`. Show a color-coded indicator on tasks in the Projects view.

**Files:**
- Modify: `backend/api/schemas.py`
- Modify: `frontend/src/types.ts`
- Modify: `frontend/src/views/Projects.tsx`
- Test: `tests/api/test_tasks.py`

**Step 1: Write failing test**

Append to `tests/api/test_tasks.py`:

```python
def test_task_with_deadline_has_urgency(client):
    goal = client.post("/api/goals", json={
        "title": "G", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 5
    }).json()
    from datetime import datetime, timedelta
    deadline = (datetime.utcnow() + timedelta(days=7)).isoformat()
    task = client.post("/api/tasks", json={
        "project_id": proj["id"],
        "title": "Deadline task",
        "cognitive_load": 2,
        "estimated_minutes": 60,
        "deadline": deadline,
    }).json()
    assert "urgency" in task
    assert task["urgency"] is not None
    assert task["urgency"] > 0.0


def test_task_without_deadline_has_null_urgency(client):
    goal = client.post("/api/goals", json={
        "title": "G2", "tier": "mid", "weight": 1.0, "target_date": "2027-01-01"
    }).json()
    proj = client.post("/api/projects", json={
        "title": "P2", "goal_id": goal["id"], "category": "engineering",
        "estimated_hours_remaining": 5
    }).json()
    task = client.post("/api/tasks", json={
        "project_id": proj["id"],
        "title": "No deadline task",
        "cognitive_load": 1,
        "estimated_minutes": 30,
    }).json()
    assert "urgency" in task
    assert task["urgency"] is None
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_tasks.py::test_task_with_deadline_has_urgency -v
```

Expected: FAIL — `KeyError: 'urgency'`.

**Step 3: Add `urgency` to `TaskResponse` in `backend/api/schemas.py`**

Read the file. In `TaskResponse`:

a) Add `urgency: float | None = None` field:

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
    urgency: float | None = None   # <-- add this line
```

b) Add urgency computation inside the existing `model_validator`:

```python
    @model_validator(mode='before')
    @classmethod
    def extract_dependency_ids(cls, data):
        if hasattr(data, '__table__'):
            result = {col.name: getattr(data, col.name) for col in data.__table__.columns}
            result['dependency_ids'] = [d.id for d in getattr(data, 'dependencies', [])]
            # Compute urgency from deadline + created_at
            deadline = result.get('deadline')
            created_at = result.get('created_at')
            if deadline and created_at:
                from backend.scheduler.decay import compute_urgency
                result['urgency'] = round(compute_urgency(1.0, deadline, created_at), 3)
            else:
                result['urgency'] = None
            return result
        return data
```

**Step 4: Run tests**

```bash
pytest tests/api/test_tasks.py::test_task_with_deadline_has_urgency tests/api/test_tasks.py::test_task_without_deadline_has_null_urgency -v
```

Expected: 2 passed.

**Step 5: Run full suite**

```bash
pytest tests/ -q
```

Expected: 192 passed (190 + 2 new).

**Step 6: Commit backend**

```bash
git add backend/api/schemas.py tests/api/test_tasks.py
git commit -m "feat: urgency score in TaskResponse — computed from temporal decay"
```

**Step 7: Add `urgency` to `Task` type in `frontend/src/types.ts`**

Read the file. In the `Task` interface, add:

```typescript
  urgency?: number | null
```

**Step 8: Add `UrgencyBadge` and wire into `TaskRow` in `frontend/src/views/Projects.tsx`**

Read the file. Add this component before `TaskRow`:

```typescript
function UrgencyBadge({ urgency }: { urgency?: number | null }) {
  if (urgency == null) return null
  let color = 'text-zinc-700'
  if (urgency > 6) color = 'text-red-500'
  else if (urgency > 3) color = 'text-orange-400'
  else if (urgency > 1.5) color = 'text-yellow-500'
  else color = 'text-emerald-700'
  return (
    <span className={`text-xs font-mono shrink-0 ${color}`} title={`urgency: ${urgency.toFixed(2)}`}>
      ↑{urgency.toFixed(1)}
    </span>
  )
}
```

In `TaskRow`, inside the collapsed row JSX, add `<UrgencyBadge urgency={task.urgency} />` after the `LoadDots` component. Read `TaskRow` fully to find the right placement — it's the row that shows the task title, status badge, and LoadDots.

**Step 9: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 10: Commit frontend**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/types.ts frontend/src/views/Projects.tsx
git commit -m "feat: urgency indicator on tasks — color-coded temporal decay visualization"
```

---

## Task 3: Quick-Add Floating Button

A global `+` button (visible on all pages) that opens a text input, sends natural language to Eden's chat, and auto-approves any `create_task` or `create_project` actions. No page navigation required.

**Files:**
- Modify: `frontend/src/api/chat.ts`
- Create: `frontend/src/components/QuickAdd.tsx`
- Modify: `frontend/src/App.tsx`

**Step 1: Add `executeActions` to `frontend/src/api/chat.ts`**

Read the file. The current `sendMessage` is there. Append:

```typescript
export const executeActions = (actions: Array<{
  tool_use_id: string
  name: string
  input: Record<string, unknown>
  approved: boolean
}>) =>
  apiFetch<{ executed: number; skipped: number }>('/chat/actions/execute', {
    method: 'POST',
    body: JSON.stringify({ actions }),
  })
```

**Step 2: Create `frontend/src/components/QuickAdd.tsx`**

```typescript
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessage, executeActions } from '../api/chat'

export default function QuickAdd() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: async (input: string) => {
      const chatResp = await sendMessage(`Add task: ${input}`)
      if (chatResp.proposed_actions.length === 0) {
        return { executed: 0 }
      }
      const actions = chatResp.proposed_actions.map(a => ({
        tool_use_id: a.tool_use_id,
        name: a.name,
        input: a.input as Record<string, unknown>,
        approved: a.name === 'create_task' || a.name === 'create_project',
      }))
      return executeActions(actions)
    },
    onSuccess: (result) => {
      setFeedback(result.executed > 0 ? 'added ✓' : 'nothing to add')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setTimeout(() => {
        setOpen(false)
        setText('')
        setFeedback(null)
      }, 1200)
    },
    onError: () => {
      setFeedback('error — try the chat instead')
    },
  })

  const handleSubmit = () => {
    if (!text.trim() || isPending) return
    mutate(text.trim())
  }

  return (
    <>
      <button
        onClick={() => { setOpen(v => !v); setFeedback(null) }}
        className="fixed bottom-6 right-6 w-8 h-8 bg-zinc-950 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-base transition-colors flex items-center justify-center z-50"
        title="Quick add task (natural language)"
      >
        +
      </button>
      {open && (
        <div className="fixed bottom-16 right-6 w-80 bg-zinc-950 border border-zinc-800 p-3 z-50 shadow-2xl">
          <p className="text-zinc-600 text-xs mb-2">quick add — describe the task naturally</p>
          <input
            autoFocus
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs px-2 py-1.5 outline-none focus:border-zinc-600 placeholder-zinc-700"
            placeholder="finish ML paper section 3 by Friday, deep work, ~90min..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') { setOpen(false); setFeedback(null) }
            }}
            disabled={isPending}
          />
          {feedback ? (
            <p className={`text-xs mt-1.5 ${feedback.includes('✓') ? 'text-emerald-600' : 'text-zinc-500'}`}>
              {feedback}
            </p>
          ) : (
            <div className="flex justify-between mt-1.5">
              <button
                onClick={handleSubmit}
                disabled={isPending || !text.trim()}
                className="text-xs text-zinc-500 hover:text-zinc-300 disabled:text-zinc-800 transition-colors"
              >
                {isPending ? 'thinking...' : '[ add ]'}
              </button>
              <button
                onClick={() => { setOpen(false); setText('') }}
                className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
              >
                [ cancel ]
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
```

**Step 3: Add `<QuickAdd />` to `frontend/src/App.tsx`**

Read the file. Add import:
```typescript
import QuickAdd from './components/QuickAdd'
```

In the return, add `<QuickAdd />` as a sibling of `<Routes>` — not inside it. It needs to be present on all pages. Place it just before the closing fragment or router element:

```tsx
    <>
      <Router>
        ...
        <Routes>...</Routes>
      </Router>
      <QuickAdd />
    </>
```

Read App.tsx carefully to find the correct structure and placement.

**Step 4: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 5: Run backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q 2>&1 | tail -3
```

Expected: 192 passed.

**Step 6: Commit**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/api/chat.ts frontend/src/components/QuickAdd.tsx frontend/src/App.tsx
git commit -m "feat: quick-add floating button — natural language task creation from any page"
```

---

## Task 4: Weekly Planning View

A `/plan/week` view showing 7 columns of draft blocks, generated in one action, lockable in one click. No per-day navigation required.

**Files:**
- Modify: `backend/api/plan.py`
- Modify: `frontend/src/api/plan.ts`
- Modify: `frontend/src/types.ts`
- Create: `frontend/src/views/WeekPlanningSession.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Sidebar.tsx`
- Test: `tests/api/test_plan.py`

**Step 1: Write failing tests**

Append to `tests/api/test_plan.py`:

```python
def test_generate_week_returns_seven_days(client):
    from datetime import date, timedelta
    # Get the Monday of the current week
    today = date.today()
    monday = today - timedelta(days=today.weekday())

    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_response("fake-task-id")

        r = client.post(f"/api/plan/generate-week?start_date={monday.isoformat()}")

    assert r.status_code == 200
    data = r.json()
    assert "days" in data
    assert len(data["days"]) == 7
    assert data["week_start"] == monday.isoformat()


def test_lock_week_commits_all_drafts(client):
    from datetime import date, timedelta
    today = date.today()
    monday = today - timedelta(days=today.weekday())

    # First generate
    with patch("backend.api.plan.anthropic.Anthropic") as MockAnthropic:
        mock_client = MagicMock()
        MockAnthropic.return_value = mock_client
        mock_client.messages.create.return_value = _mock_plan_response("fake-task-id")
        client.post(f"/api/plan/generate-week?start_date={monday.isoformat()}")

    # Then lock
    r = client.post(f"/api/plan/lock-week?start_date={monday.isoformat()}")
    assert r.status_code == 200
    data = r.json()
    assert "locked" in data
    assert data["locked"] >= 0
```

**Step 2: Run to verify they fail**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate
pytest tests/api/test_plan.py::test_generate_week_returns_seven_days -v
```

Expected: FAIL — 404.

**Step 3: Add `generate_week` and `lock_week` to `backend/api/plan.py`**

Read `plan.py` fully first. Add these imports at the top if not present:
```python
from datetime import timedelta
```

Extract the generation core from `generate_plan` into a private helper, then call it from both `generate_plan` and `generate_week`:

```python
def _generate_for_date(target_date: date, db: Session) -> dict:
    """Core logic: generate draft blocks for one date. Returns {blocks, summary}."""
    # Delete existing drafts for this date
    db.query(ScheduleBlock).filter(
        ScheduleBlock.date == target_date,
        ScheduleBlock.is_draft == True,
    ).delete()
    db.commit()

    snapshot = build_context_snapshot(db)
    context_str = json.dumps(snapshot, default=str, indent=2)

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
    return {"blocks": created_blocks, "summary": proposal.get("summary", "")}


@router.post("/generate-week")
def generate_week(start_date: date = Query(...), db: Session = Depends(get_db)):
    results = []
    for i in range(7):
        day = start_date + timedelta(days=i)
        day_result = _generate_for_date(day, db)
        results.append({"date": str(day), **day_result})
    return {"days": results, "week_start": str(start_date)}


@router.post("/lock-week")
def lock_week(start_date: date = Query(...), db: Session = Depends(get_db)):
    end_date = start_date + timedelta(days=7)
    drafts = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= start_date,
        ScheduleBlock.date < end_date,
        ScheduleBlock.is_draft == True,
    ).all()
    for block in drafts:
        block.is_draft = False
    db.commit()
    return {"locked": len(drafts), "week_start": str(start_date)}
```

Also update the existing `generate_plan` endpoint to use `_generate_for_date`:

```python
@router.post("/generate")
def generate_plan(target_date: date = Query(default=None), db: Session = Depends(get_db)):
    if target_date is None:
        from datetime import date as _date
        target_date = _date.today()
    result = _generate_for_date(target_date, db)
    return {**result, "date": str(target_date)}
```

**Step 4: Run tests**

```bash
pytest tests/api/test_plan.py -v
```

Expected: all passing including 2 new tests.

**Step 5: Run full suite**

```bash
pytest tests/ -q
```

Expected: 194 passed.

**Step 6: Commit backend**

```bash
git add backend/api/plan.py tests/api/test_plan.py
git commit -m "feat: generate-week and lock-week plan endpoints"
```

**Step 7: Update `frontend/src/api/plan.ts`**

Read the file. Add:

```typescript
export interface WeekPlanProposal {
  days: Array<{ date: string; blocks: DraftBlock[]; summary: string }>
  week_start: string
}

export const generateWeekPlan = (startDate: string) =>
  apiFetch<WeekPlanProposal>(`/plan/generate-week?start_date=${startDate}`, { method: 'POST' })

export const lockWeekPlan = (startDate: string) =>
  apiFetch<{ locked: number; week_start: string }>(`/plan/lock-week?start_date=${startDate}`, { method: 'POST' })
```

Note: `DraftBlock` is imported from `'../types'` in `plan.ts` already. Check the existing imports and add `WeekPlanProposal` either inline here or to `types.ts`. Inline in the API file is fine since it's only used here.

**Step 8: Create `frontend/src/views/WeekPlanningSession.tsx`**

```typescript
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { generateWeekPlan, lockWeekPlan, discardPlan } from '../api/plan'
import type { DraftBlock } from '../types'

function getMonday(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'p' : 'a'
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${ampm}`
}

function DayColumn({ date, blocks }: { date: string; blocks: DraftBlock[] }) {
  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  return (
    <div className="flex-1 min-w-0 border-r border-zinc-900 last:border-r-0 px-3">
      <p className="text-zinc-600 text-xs pb-2 mb-2 border-b border-zinc-900">{fmtDay(date)}</p>
      {sorted.length === 0 && (
        <p className="text-zinc-800 text-xs">—</p>
      )}
      {sorted.map(b => (
        <div key={b.id} className="mb-2">
          <p className="text-zinc-600 text-xs">{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</p>
          <p className="text-zinc-300 text-xs">{b.task_id ?? 'free'}</p>
          {b.reason && <p className="text-zinc-700 text-xs">{b.reason}</p>}
        </div>
      ))}
    </div>
  )
}

export default function WeekPlanningSession() {
  const qc = useQueryClient()
  const weekStart = getMonday()
  const [days, setDays] = useState<Array<{ date: string; blocks: DraftBlock[]; summary: string }>>([])
  const [locked, setLocked] = useState(false)

  const { mutate: generate, isPending: generating } = useMutation({
    mutationFn: () => generateWeekPlan(weekStart),
    onSuccess: (data) => setDays(data.days),
  })

  const { mutate: lock, isPending: locking } = useMutation({
    mutationFn: () => lockWeekPlan(weekStart),
    onSuccess: () => {
      setLocked(true)
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })

  const { mutate: discard } = useMutation({
    mutationFn: async () => {
      for (const day of days) {
        await discardPlan(day.date)
      }
    },
    onSuccess: () => setDays([]),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-sm text-zinc-200">plan the week</h1>
          <p className="text-xs text-zinc-600">week of {fmtDay(weekStart)}</p>
        </div>
        <div className="flex gap-3">
          {!locked && (
            <>
              <button
                onClick={() => generate()}
                disabled={generating}
                className="text-xs text-zinc-500 hover:text-zinc-300 disabled:text-zinc-800 transition-colors"
              >
                {generating ? 'generating...' : days.length > 0 ? '[ regenerate ]' : '[ generate week ]'}
              </button>
              {days.length > 0 && (
                <>
                  <button
                    onClick={() => lock()}
                    disabled={locking}
                    className="text-xs text-emerald-500 hover:text-emerald-400 border border-zinc-700 px-2 py-0.5 transition-colors"
                  >
                    {locking ? 'locking...' : '[ lock in week ]'}
                  </button>
                  <button
                    onClick={() => discard()}
                    className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
                  >
                    [ discard ]
                  </button>
                </>
              )}
            </>
          )}
          {locked && <span className="text-xs text-emerald-600">● week locked in</span>}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {days.length === 0 && !generating && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-700 text-xs">click [ generate week ] to propose a schedule</p>
          </div>
        )}
        {generating && days.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-zinc-600 text-xs">generating 7 days...</p>
          </div>
        )}
        {days.length > 0 && (
          <div className="flex h-full">
            {days.map(d => (
              <DayColumn key={d.date} date={d.date} blocks={d.blocks} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

**Step 9: Add `/plan/week` route to `frontend/src/App.tsx`**

Read the file. Add import:
```typescript
import WeekPlanningSession from './views/WeekPlanningSession'
```
Add route:
```typescript
<Route path="/plan/week" element={<WeekPlanningSession />} />
```

**Step 10: Add week plan link to `frontend/src/components/Sidebar.tsx`**

Read the file. Add `{ label: '✦', title: 'WEEK PLAN', path: '/plan/week' }` after the existing plan link. Follow the exact pattern already used.

**Step 11: Verify TypeScript**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS/frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

**Step 12: Run full backend tests**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS && source .venv/bin/activate && pytest tests/ -q 2>&1 | tail -3
```

Expected: 194 passed.

**Step 13: Commit frontend**

```bash
cd /Users/averyclapp/Documents/Coding/GitProjects/EdenOS
git add frontend/src/api/plan.ts frontend/src/views/WeekPlanningSession.tsx frontend/src/App.tsx frontend/src/components/Sidebar.tsx
git commit -m "feat: weekly planning view — generate and lock a full week of draft blocks"
```

---

## Done

After all 4 tasks, Eden has:
- A focus timer that auto-captures learning data without extra friction
- Urgency scores on every task with deadline, color-coded by how hot they are
- A global quick-add that takes natural language from anywhere in the app
- A weekly planning view for top-down week-level scheduling
