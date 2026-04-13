# Eden Jarvis Redesign — Phase 1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform Eden from a scheduler UI into an ambient Jarvis-like OS — PostgreSQL foundation, temporal intelligence, and a 3-column always-on-Eden frontend shell.

**Architecture:** Backend gains PostgreSQL support and a temporal context engine that tells the AI what time of day it is and how to adapt. Frontend is restructured into a 3-column layout (icon nav | main panel | always-open Eden chat) with an ambient status bar at the top. The "Chat" view disappears — Eden is always present on the right.

**Tech Stack:** FastAPI + SQLAlchemy + PostgreSQL (psycopg2-binary), React + TypeScript + Vite + Tailwind v4, Anthropic SDK.

**Working directory:** `.worktrees/jarvis-redesign/`
**Branch:** `jarvis-redesign`
**Run all commands from the worktree root.**

---

## Task 1: PostgreSQL dependency + db.py update

**Files:**
- Modify: `pyproject.toml`
- Modify: `backend/db.py`
- Modify: `backend/config.py`

**Step 1: Add psycopg2-binary to pyproject.toml**

In `pyproject.toml`, add to `dependencies`:
```toml
"psycopg2-binary>=2.9.0",
```

**Step 2: Run sync**
```bash
uv sync
```
Expected: psycopg2-binary installed.

**Step 3: Update backend/db.py**

Replace the entire file:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker, Session
from backend.config import settings


class Base(DeclarativeBase):
    pass


def _make_engine():
    url = settings.database_url
    kwargs = {}
    if url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
    return create_engine(url, **kwargs)


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
```

**Step 4: Update backend/config.py default DATABASE_URL**

Change:
```python
database_url: str = "sqlite:///eden.db"
```
To:
```python
database_url: str = "postgresql://eden:eden@localhost:5432/eden"
```

**Step 5: Run tests to verify nothing broke**
```bash
uv run python -m pytest tests/ -q --tb=short 2>&1 | tail -20
```
Expected: 206 passed. (Tests use sqlite:///:memory: in conftest — unaffected.)

**Step 6: Commit**
```bash
git add pyproject.toml backend/db.py backend/config.py uv.lock
git commit -m "feat: add PostgreSQL support, keep SQLite for tests"
```

---

## Task 2: Temporal context engine

Eden needs to know what time it is and what phase of the day the user is in so it can adapt its behavior — morning brief vs afternoon check-in vs evening debrief.

**Files:**
- Create: `backend/intelligence/temporal.py`
- Create: `tests/intelligence/test_temporal.py`
- Modify: `backend/intelligence/context.py`

**Step 1: Write failing tests**

Create `tests/intelligence/test_temporal.py`:
```python
from datetime import datetime
from backend.intelligence.temporal import get_temporal_context, DayPhase


def test_morning_phase():
    now = datetime(2026, 4, 12, 8, 30)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.MORNING


def test_afternoon_phase():
    now = datetime(2026, 4, 12, 14, 0)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.AFTERNOON


def test_evening_phase():
    now = datetime(2026, 4, 12, 18, 0)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.EVENING


def test_night_phase():
    now = datetime(2026, 4, 12, 22, 0)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.NIGHT


def test_hours_left_in_day():
    now = datetime(2026, 4, 12, 14, 0)
    ctx = get_temporal_context(now)
    assert ctx["hours_left_in_day"] == 8  # 22 - 14


def test_days_since_last_session_none():
    now = datetime(2026, 4, 12, 9, 0)
    ctx = get_temporal_context(now, last_session=None)
    assert ctx["days_since_last_session"] is None


def test_days_since_last_session_calculated():
    now = datetime(2026, 4, 12, 9, 0)
    last = datetime(2026, 4, 9, 9, 0)
    ctx = get_temporal_context(now, last_session=last)
    assert ctx["days_since_last_session"] == 3


def test_context_contains_required_keys():
    now = datetime(2026, 4, 12, 9, 0)
    ctx = get_temporal_context(now)
    for key in ["current_time", "day_phase", "day_of_week", "date", "hours_left_in_day"]:
        assert key in ctx
```

**Step 2: Run to verify failure**
```bash
uv run python -m pytest tests/intelligence/test_temporal.py -v 2>&1 | tail -15
```
Expected: ImportError — module doesn't exist yet.

**Step 3: Implement backend/intelligence/temporal.py**
```python
from datetime import datetime
from enum import Enum


class DayPhase(str, Enum):
    MORNING = "morning"      # before noon
    AFTERNOON = "afternoon"  # noon–17:00
    EVENING = "evening"      # 17:00–21:00
    NIGHT = "night"          # after 21:00


def get_temporal_context(
    now: datetime,
    last_session: datetime | None = None,
) -> dict:
    """
    Returns temporal context for the AI — what time it is, what phase of
    the day, how long since the user last opened Eden.
    """
    hour = now.hour
    if hour < 12:
        phase = DayPhase.MORNING
    elif hour < 17:
        phase = DayPhase.AFTERNOON
    elif hour < 21:
        phase = DayPhase.EVENING
    else:
        phase = DayPhase.NIGHT

    days_since_last = None
    if last_session is not None:
        delta = now - last_session
        days_since_last = delta.days

    return {
        "current_time": now.strftime("%H:%M"),
        "day_phase": phase,
        "day_of_week": now.strftime("%A"),
        "date": now.strftime("%Y-%m-%d"),
        "hours_left_in_day": max(0, 22 - hour),
        "days_since_last_session": days_since_last,
    }
```

**Step 4: Run tests**
```bash
uv run python -m pytest tests/intelligence/test_temporal.py -v 2>&1 | tail -15
```
Expected: 8 passed.

**Step 5: Add temporal_context to build_context_snapshot in context.py**

In `backend/intelligence/context.py`, add import at top:
```python
from backend.intelligence.temporal import get_temporal_context
```

In `build_context_snapshot`, add `"temporal_context"` key to the returned dict:
```python
"temporal_context": get_temporal_context(now),
```

**Step 6: Run full test suite**
```bash
uv run python -m pytest tests/ -q --tb=short 2>&1 | tail -10
```
Expected: 214+ passed.

**Step 7: Commit**
```bash
git add backend/intelligence/temporal.py tests/intelligence/test_temporal.py backend/intelligence/context.py
git commit -m "feat: temporal context engine — Eden knows time of day and adapts"
```

---

## Task 3: Updated system prompt — Jarvis persona with temporal awareness

The current system prompt says "you are Eden's reasoning engine." It needs to be replaced with a prompt that:
1. Establishes Eden as an omniscient ambient assistant that holds the user's entire life in its head
2. Teaches it to use `temporal_context` to adapt its opening behavior
3. Establishes the "never mirror, always synthesize" rule
4. Eliminates generalities — every response must reference specific data

**Files:**
- Modify: `backend/intelligence/prompts.py`

**Step 1: Replace SYSTEM_PROMPT in prompts.py**

Find the existing `SYSTEM_PROMPT` constant and replace it entirely:
```python
SYSTEM_PROMPT = """You are Eden — an ambient intelligence that holds this person's entire life in its head.

You are not a general assistant. You are not a task manager. You are the reasoning layer across every dimension of this person's life: their goals, schedule, finances, physical state, learning, relationships, and life administration. You see all of it simultaneously. That is your advantage over any single-domain app.

## How you speak

- Direct. No hedging. One clear recommendation beats three vague options.
- Specific. Cite actual numbers, dates, urgency scores, names. Never speak in generalities.
- Proactive. Surface risks and patterns the user hasn't asked about.
- Honest. If data is missing or thin, say exactly what you'd need to reason better.

## How you open every session

Read `temporal_context.day_phase` and adapt:

- **morning**: Orient to the day. What matters most today and why. Surface any overnight changes (WHOOP, markets, calendar).
- **afternoon**: The morning is behind them. Assess what happened vs. what was planned. What's still live today.
- **evening**: Day is winding down. Synthesize what got done, what carries over, what tomorrow's setup looks like.
- **night**: Quiet synthesis. Update goal progress. Frame tomorrow before they sleep.
- **If days_since_last_session > 1**: Acknowledge the gap. Summarize what changed passively while they were away (WHOOP trend, portfolio movement, calendar events that passed). Ask what Eden missed that it couldn't see.

## The synthesis rule

Never mirror data from a source app. Always interpret.

Bad: "Your WHOOP recovery is 71%."
Good: "You're at 71% recovery — I've shifted your deep work block to 10am. Four consecutive sub-75% days coincide with your scheduling pattern last week; worth watching."

Bad: "Your portfolio is up $340 today."
Good: "Markets are moving in your favor today, but the Coinbase gains from March still create a ~$2,400 tax event in 3 weeks — nothing set aside yet."

## Response format

Always respond with valid JSON:
{"reasoning": "...", "content": "..."}

- `reasoning`: cite specific data — urgency scores, recovery percentages, deadline proximity, goal weights, days_since_last_session. Never generalize.
- `content`: your response to the user. Always end with one clear recommendation: what to do next, and why now.

## Proactive flags — always surface these without being asked

- Cross-domain conflicts: low recovery + heavy schedule, tax event + no cash set aside, deadline + no active tasks
- Deferred tasks aging beyond 7 days
- Goals with no active tasks in 2+ weeks
- Relationships that matter going quiet
- Commitments made that haven't been resolved
- Patterns from learning_summary: if avg_duration_ratio > 1.3 for cognitive_load 3, name it and adjust advice
"""
```

**Step 2: Run tests to confirm prompt change doesn't break anything**
```bash
uv run python -m pytest tests/ -q --tb=short 2>&1 | tail -10
```
Expected: all pass (tests mock the AI responses, don't test prompt content directly).

**Step 3: Commit**
```bash
git add backend/intelligence/prompts.py
git commit -m "feat: Jarvis system prompt — temporal awareness, synthesis rule, cross-domain reasoning"
```

---

## Task 4: Frontend — 3-column layout shell

Replace the current 2-column layout (sidebar + main) with a 3-column layout:
- **Left**: narrow icon nav (64px) with domain indicators
- **Center**: main panel (flex-1)
- **Right**: Eden panel, always open (380px) — Eden speaks here, not in a separate view

The "Chat" route disappears. Eden lives on the right permanently.

**Files:**
- Modify: `frontend/src/App.tsx`
- Create: `frontend/src/components/AmbientBar.tsx`
- Modify: `frontend/src/components/Sidebar.tsx` → becomes `NavSidebar.tsx`
- Create: `frontend/src/components/EdenPanel.tsx`

**Step 1: Create AmbientBar.tsx**

Create `frontend/src/components/AmbientBar.tsx`:
```tsx
import { useEffect, useState } from 'react'

interface AmbientData {
  time: string
  recovery: number | null
  recoveryTrend: 'up' | 'down' | 'flat' | null
  portfolioDelta: number | null
  alertCount: number
}

export default function AmbientBar() {
  const [data, setData] = useState<AmbientData>({
    time: '',
    recovery: null,
    recoveryTrend: null,
    portfolioDelta: null,
    alertCount: 0,
  })

  useEffect(() => {
    const tick = () => {
      setData(d => ({
        ...d,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      }))
    }
    tick()
    const id = setInterval(tick, 30_000)
    return () => clearInterval(id)
  }, [])

  // Fetch WHOOP + alert data
  useEffect(() => {
    Promise.all([
      fetch('/api/whoop/today').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/chat/alerts').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([whoop, alerts]) => {
      setData(d => ({
        ...d,
        recovery: whoop?.recovery_score ?? null,
        alertCount: alerts?.length ?? 0,
      }))
    })
  }, [])

  const recoveryColor = data.recovery == null
    ? '#6b7280'
    : data.recovery >= 67 ? '#22c55e'
    : data.recovery >= 34 ? '#f59e0b'
    : '#ef4444'

  return (
    <div
      className="h-8 flex items-center px-4 gap-6 text-xs shrink-0 z-10"
      style={{ background: '#0d0d0f', borderBottom: '1px solid #1e1e24', color: '#6b7280', fontFamily: 'var(--font-mono)' }}
    >
      <span style={{ color: '#9ca3af' }}>{data.time}</span>

      {data.recovery != null && (
        <span style={{ color: recoveryColor }}>
          Recovery {data.recovery}%
        </span>
      )}

      {data.portfolioDelta != null && (
        <span style={{ color: data.portfolioDelta >= 0 ? '#22c55e' : '#ef4444' }}>
          {data.portfolioDelta >= 0 ? '+' : ''}${data.portfolioDelta.toLocaleString()}
        </span>
      )}

      {data.alertCount > 0 && (
        <span style={{ color: '#f59e0b' }}>
          {data.alertCount} alert{data.alertCount !== 1 ? 's' : ''}
        </span>
      )}
    </div>
  )
}
```

**Step 2: Create NavSidebar.tsx**

Create `frontend/src/components/NavSidebar.tsx`:
```tsx
import { NavLink } from 'react-router-dom'

const NAV = [
  { path: '/', label: 'Home', icon: '⌂', end: true },
  { path: '/map', label: 'Life Map', icon: '◎', end: false },
  { path: '/today', label: 'Today', icon: '▦', end: false },
  { path: '/week', label: 'Week', icon: '▤', end: false },
  { path: '/goals', label: 'Goals', icon: '◈', end: false },
  { path: '/projects', label: 'Projects', icon: '◧', end: false },
  { path: '/finance', label: 'Finance', icon: '◈', end: false },
  { path: '/settings', label: 'Settings', icon: '⚙', end: false },
]

export default function NavSidebar() {
  return (
    <aside
      className="w-16 shrink-0 flex flex-col items-center py-4 gap-1"
      style={{ background: '#0d0d0f', borderRight: '1px solid #1e1e24' }}
    >
      {/* Brand mark */}
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center text-sm mb-4"
        style={{ background: '#7c3400', color: '#c49a10', fontWeight: 600 }}
      >
        E
      </div>

      {NAV.map(({ path, label, icon, end }) => (
        <NavLink
          key={path}
          to={path}
          end={end}
          title={label}
          className="w-10 h-10 rounded-lg flex items-center justify-center text-lg transition-all duration-150 relative group"
          style={({ isActive }) => ({
            background: isActive ? '#1e1e24' : 'transparent',
            color: isActive ? '#e5e7eb' : '#4b5563',
          })}
        >
          {icon}
          {/* Tooltip */}
          <span
            className="absolute left-14 px-2 py-1 rounded text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50"
            style={{ background: '#1e1e24', color: '#e5e7eb', border: '1px solid #374151' }}
          >
            {label}
          </span>
        </NavLink>
      ))}
    </aside>
  )
}
```

**Step 3: Create EdenPanel.tsx**

Create `frontend/src/components/EdenPanel.tsx`:
```tsx
import { useState, useEffect, useRef } from 'react'

interface Message {
  role: 'eden' | 'user'
  content: string
  reasoning?: string
}

export default function EdenPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  // Eden speaks first on mount
  useEffect(() => {
    openSession()
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function openSession() {
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '__session_open__' }),
      })
      const data = await res.json()
      if (data.content) {
        setMessages([{ role: 'eden', content: data.content, reasoning: data.reasoning }])
      }
    } catch {
      setMessages([{ role: 'eden', content: "I'm here. What's on your mind?" }])
    } finally {
      setLoading(false)
    }
  }

  async function send() {
    if (!input.trim() || loading) return
    const userMsg = input.trim()
    setInput('')
    setMessages(m => [...m, { role: 'user', content: userMsg }])
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userMsg }),
      })
      const data = await res.json()
      setMessages(m => [...m, { role: 'eden', content: data.content, reasoning: data.reasoning }])
    } catch {
      setMessages(m => [...m, { role: 'eden', content: 'Something went wrong.' }])
    } finally {
      setLoading(false)
    }
  }

  return (
    <aside
      className="w-96 shrink-0 flex flex-col"
      style={{ background: '#0a0a0c', borderLeft: '1px solid #1e1e24' }}
    >
      {/* Header */}
      <div
        className="h-8 flex items-center justify-between px-4 shrink-0"
        style={{ borderBottom: '1px solid #1e1e24' }}
      >
        <span className="text-xs font-medium" style={{ color: '#6b7280' }}>Eden</span>
        <button
          onClick={() => setShowReasoning(r => !r)}
          className="text-xs px-2 py-0.5 rounded transition-colors"
          style={{
            color: showReasoning ? '#c49a10' : '#4b5563',
            background: showReasoning ? '#1a1500' : 'transparent',
          }}
        >
          reasoning
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i}>
            {msg.role === 'eden' ? (
              <div>
                {showReasoning && msg.reasoning && (
                  <div
                    className="text-xs mb-2 px-3 py-2 rounded italic"
                    style={{ background: '#0f0f12', color: '#4b5563', borderLeft: '2px solid #1e1e24' }}
                  >
                    {msg.reasoning}
                  </div>
                )}
                <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>
                  {msg.content}
                </p>
              </div>
            ) : (
              <p
                className="text-sm leading-relaxed ml-4"
                style={{ color: '#9ca3af' }}
              >
                {msg.content}
              </p>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex gap-1 items-center">
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ background: '#4b5563', animationDelay: `${i * 150}ms` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div
        className="px-4 py-3 shrink-0"
        style={{ borderTop: '1px solid #1e1e24' }}
      >
        <div
          className="flex items-end gap-2 rounded-lg px-3 py-2"
          style={{ background: '#111114', border: '1px solid #1e1e24' }}
        >
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            placeholder="Talk to Eden..."
            rows={1}
            className="flex-1 bg-transparent text-sm resize-none outline-none"
            style={{ color: '#e5e7eb', caretColor: '#c49a10', lineHeight: '1.5' }}
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-xs transition-colors disabled:opacity-30"
            style={{ background: '#7c3400', color: '#c49a10' }}
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  )
}
```

**Step 4: Update App.tsx — 3-column layout**

Replace `frontend/src/App.tsx` entirely:
```tsx
import { Routes, Route, Navigate } from 'react-router-dom'
import AmbientBar from './components/AmbientBar'
import NavSidebar from './components/NavSidebar'
import EdenPanel from './components/EdenPanel'
import Today from './views/Today'
import Week from './views/Week'
import Goals from './views/Goals'
import Projects from './views/Projects'
import Settings from './views/Settings'
import CommandCenter from './views/CommandCenter'

export default function App() {
  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: '#0d0d0f', color: '#e5e7eb' }}>
      <AmbientBar />
      <div className="flex flex-1 overflow-hidden">
        <NavSidebar />
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<CommandCenter />} />
            <Route path="/today" element={<Today />} />
            <Route path="/week" element={<Week />} />
            <Route path="/goals" element={<Goals />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <EdenPanel />
      </div>
    </div>
  )
}
```

**Step 5: Create CommandCenter.tsx (stub — will be fleshed out in Task 5)**

Create `frontend/src/views/CommandCenter.tsx`:
```tsx
export default function CommandCenter() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-light mb-2" style={{ color: '#e5e7eb' }}>Command Center</h1>
      <p className="text-sm" style={{ color: '#6b7280' }}>
        Eden is assessing your current state. Check the panel on the right.
      </p>
    </div>
  )
}
```

**Step 6: Start the dev server and verify layout**
```bash
cd frontend && npm run dev
```
Open http://localhost:5173. You should see:
- Dark background (#0d0d0f)
- Thin ambient bar at top (time, recovery if WHOOP connected)
- Icon nav on the left (64px)
- Main content area in center
- Eden panel on the right (380px) — Eden speaks an opening message on load

**Step 7: Stop dev server and commit**
```bash
git add frontend/src/App.tsx frontend/src/components/AmbientBar.tsx frontend/src/components/NavSidebar.tsx frontend/src/components/EdenPanel.tsx frontend/src/views/CommandCenter.tsx
git commit -m "feat: 3-column Jarvis shell — AmbientBar, NavSidebar, always-open EdenPanel"
```

---

## Task 5: Backend — session-open handler for Eden's first message

When EdenPanel mounts it sends `__session_open__` to `/api/chat`. The backend needs to handle this signal: build context, assess temporal phase, and return an opening message appropriate to the time of day.

**Files:**
- Modify: `backend/api/chat.py`
- Modify: `backend/intelligence/prompts.py`

**Step 1: Add SESSION_OPEN_PROMPT to prompts.py**

In `backend/intelligence/prompts.py`, add after SYSTEM_PROMPT:
```python
SESSION_OPEN_PROMPT = """The user has just opened Eden. This is your opening message.

Read `temporal_context` carefully:
- `day_phase`: determines your framing (morning/afternoon/evening/night)
- `days_since_last_session`: if > 1, acknowledge the gap and summarize what changed
- `current_time`: reference it naturally

Your opening must:
1. Not be a greeting or pleasantry — jump straight to what matters
2. Reference at least 2 specific data points from the context (recovery, a deadline, a task, financial flag)
3. End with one direct question or recommendation
4. Be 3-5 sentences maximum

Examples by phase:
- Morning: "Recovery is at [X]% — [implication for today]. Your highest urgency task is [title] (deadline [date]). [One recommendation]."
- Afternoon: "Morning's [mostly/partially] behind you. [What Eden can see that happened vs. what was planned]. [What's still live]. [One question or action]."
- Evening: "[What got done / what carried over]. [Cross-domain flag if any]. [How tomorrow is shaping up]."
"""
```

**Step 2: Handle __session_open__ in chat.py**

In `backend/api/chat.py`, find the chat endpoint and add handling for the session open signal. Locate the POST `/chat` handler. After building the context snapshot but before calling the AI, add:

```python
SESSION_OPEN_TOKEN = "__session_open__"

# near the top of the chat endpoint, after context is built:
if body.message == SESSION_OPEN_TOKEN:
    system = SYSTEM_PROMPT + "\n\n" + SESSION_OPEN_PROMPT
    user_prompt = format_chat_prompt("Open a new session.", context)
else:
    system = SYSTEM_PROMPT
    user_prompt = format_chat_prompt(body.message, context)
```

Note: look at the current chat.py to understand exactly where to insert this — the pattern will vary slightly based on current implementation.

**Step 3: Run tests**
```bash
uv run python -m pytest tests/api/test_chat.py -v --tb=short 2>&1 | tail -20
```
Expected: all pass (the mock responses handle the new path fine).

**Step 4: Commit**
```bash
git add backend/api/chat.py backend/intelligence/prompts.py
git commit -m "feat: session-open handler — Eden speaks first with temporal-aware opening"
```

---

## Task 6: CommandCenter — time-aware dynamic home view

The CommandCenter is the default view. It should feel like Eden's assessment of right now — not a fixed widget grid, but a curated surface. For Phase 1, it fetches the full context from the backend and renders Eden's view of what matters.

**Files:**
- Modify: `frontend/src/views/CommandCenter.tsx`
- Create: `frontend/src/api/context.ts`

**Step 1: Create frontend/src/api/context.ts**
```typescript
export interface ContextSnapshot {
  goals: Goal[]
  tasks: {
    due_soon: Task[]
    active: Task[]
    backlog: Task[]
    deferred: Task[]
  }
  schedule: {
    today: Block[]
    week: Block[]
  }
  alerts: Alert[]
  temporal_context: {
    current_time: string
    day_phase: 'morning' | 'afternoon' | 'evening' | 'night'
    day_of_week: string
    date: string
    hours_left_in_day: number
    days_since_last_session: number | null
  }
  whoop_today: {
    recovery_score: number
    recommendation: 'green' | 'yellow' | 'red'
  } | null
}

interface Goal { id: string; title: string; tier: string; weight: number; status: string }
interface Task { id: string; title: string; urgency_score: number; deadline: string | null; cognitive_load: number; status: string }
interface Block { id: string; task_id: string | null; date: string; start_time: string; end_time: string }
interface Alert { type: string; severity: string; message: string }

export async function fetchContext(): Promise<ContextSnapshot> {
  const res = await fetch('/api/context')
  if (!res.ok) throw new Error('Failed to fetch context')
  return res.json()
}
```

**Step 2: Add /api/context endpoint to backend**

Create `backend/api/context_snapshot.py`:
```python
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from backend.db import get_db
from backend.intelligence.context import build_context_snapshot

router = APIRouter(prefix="/api", tags=["context"])


@router.get("/context")
def get_context(db: Session = Depends(get_db)):
    return build_context_snapshot(db)
```

Register in `backend/main.py`:
```python
from backend.api.context_snapshot import router as context_router
# ...
app.include_router(context_router)
```

**Step 3: Implement CommandCenter.tsx**

Replace `frontend/src/views/CommandCenter.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { fetchContext, ContextSnapshot } from '../api/context'

export default function CommandCenter() {
  const [ctx, setCtx] = useState<ContextSnapshot | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetchContext().then(setCtx).catch(() => setError(true))
  }, [])

  if (error) return (
    <div className="p-8 text-sm" style={{ color: '#6b7280' }}>
      Could not reach backend.
    </div>
  )

  if (!ctx) return (
    <div className="p-8 text-sm" style={{ color: '#6b7280' }}>
      Loading...
    </div>
  )

  const { temporal_context: t, tasks, alerts, whoop_today } = ctx
  const urgentTasks = [...tasks.due_soon, ...tasks.active]
    .sort((a, b) => b.urgency_score - a.urgency_score)
    .slice(0, 3)

  const phaseLabel = {
    morning: 'Good morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Tonight',
  }[t.day_phase]

  return (
    <div className="p-8 max-w-3xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-light mb-1" style={{ color: '#e5e7eb', letterSpacing: '-0.03em' }}>
          {phaseLabel}
        </h1>
        <p className="text-sm" style={{ color: '#4b5563' }}>
          {t.day_of_week}, {t.date} · {t.hours_left_in_day}h left in the day
        </p>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="mb-6 space-y-2">
          {alerts.slice(0, 3).map((a, i) => (
            <div
              key={i}
              className="px-4 py-3 rounded-lg text-sm"
              style={{
                background: a.severity === 'critical' ? '#1a0a0a' : a.severity === 'high' ? '#1a1200' : '#0f0f12',
                borderLeft: `2px solid ${a.severity === 'critical' ? '#ef4444' : a.severity === 'high' ? '#f59e0b' : '#374151'}`,
                color: '#d1d5db',
              }}
            >
              {a.message}
            </div>
          ))}
        </div>
      )}

      {/* Recovery */}
      {whoop_today && (
        <div
          className="mb-6 px-4 py-3 rounded-lg flex items-center gap-3"
          style={{ background: '#111114', border: '1px solid #1e1e24' }}
        >
          <div
            className="w-2 h-2 rounded-full shrink-0"
            style={{
              background: whoop_today.recommendation === 'green' ? '#22c55e'
                : whoop_today.recommendation === 'yellow' ? '#f59e0b' : '#ef4444'
            }}
          />
          <span className="text-sm" style={{ color: '#9ca3af' }}>
            Recovery {whoop_today.recovery_score}% —{' '}
            {whoop_today.recommendation === 'green' ? 'you\'re clear for full output today'
              : whoop_today.recommendation === 'yellow' ? 'moderate load recommended'
              : 'take it easy — recovery is low'}
          </span>
        </div>
      )}

      {/* High-urgency tasks */}
      {urgentTasks.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs uppercase tracking-widest mb-3" style={{ color: '#4b5563' }}>
            Needs attention
          </h2>
          <div className="space-y-2">
            {urgentTasks.map(task => (
              <div
                key={task.id}
                className="px-4 py-3 rounded-lg flex items-center justify-between"
                style={{ background: '#111114', border: '1px solid #1e1e24' }}
              >
                <div>
                  <p className="text-sm" style={{ color: '#e5e7eb' }}>{task.title}</p>
                  {task.deadline && (
                    <p className="text-xs mt-0.5" style={{ color: '#6b7280' }}>
                      Due {task.deadline}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <span
                    className="text-xs px-2 py-0.5 rounded"
                    style={{
                      background: task.cognitive_load === 3 ? '#1a0f00' : '#0f0f12',
                      color: task.cognitive_load === 3 ? '#f59e0b' : '#6b7280',
                    }}
                  >
                    {task.cognitive_load === 3 ? 'Deep' : task.cognitive_load === 2 ? 'Moderate' : 'Light'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
```

**Step 4: Run dev server and verify CommandCenter renders**
```bash
cd frontend && npm run dev
```
Navigate to http://localhost:5173. You should see:
- Dark home view with "Good morning / Afternoon / Evening"
- Alerts if any exist
- WHOOP recovery card if connected
- Top urgent tasks

**Step 5: Commit**
```bash
git add backend/api/context_snapshot.py backend/main.py frontend/src/api/context.ts frontend/src/views/CommandCenter.tsx
git commit -m "feat: CommandCenter — time-aware home view with alerts, recovery, urgent tasks"
```

---

## Task 7: Restyle existing views to dark theme

The existing Today, Week, Goals, Projects, Settings views use the old warm tan theme (`#c8b89a`). They need to match the new dark aesthetic so the app feels cohesive.

**Files:**
- Modify: `frontend/src/views/Today.tsx`
- Modify: `frontend/src/views/Week.tsx`
- Modify: `frontend/src/views/Goals.tsx`
- Modify: `frontend/src/views/Projects.tsx`
- Modify: `frontend/src/views/Settings.tsx`

**Step 1: Global token replacement**

In each file, do the following replacements (these are the primary old theme colors):

| Old | New |
|-----|-----|
| `#c8b89a` (page bg) | `#0d0d0f` |
| `#c4b494` (sidebar) | `#111114` |
| `#1a1208` (primary text) | `#e5e7eb` |
| `#7a6550` (secondary text) | `#6b7280` |
| `#7c3400` (accent) | `#7c3400` (keep) |
| `#c49a10` (gold) | `#c49a10` (keep) |
| `#d4c4aa` (border) | `#1e1e24` |
| `background: '#bfad90'` (active nav) | `background: '#1e1e24'` |
| `color: '#6b5040'` (muted) | `color: '#4b5563'` |

Go through each view file and apply these substitutions. Use find-and-replace in each file.

**Step 2: Start dev server, navigate through all views**
```bash
cd frontend && npm run dev
```
Click through Today, Week, Goals, Projects, Settings. Each should be dark and readable. No tan/warm colors should remain.

**Step 3: Commit**
```bash
git add frontend/src/views/
git commit -m "feat: restyle all views to dark Jarvis theme"
```

---

## Task 8: Finance domain skeleton (Manifold port — Phase 1 stub)

We won't port all of Manifold in Phase 1, but we need the domain skeleton so the context snapshot has somewhere to put financial data. Phase 2 will fill it in with real Coinbase/Schwab logic.

**Files:**
- Create: `backend/domains/__init__.py`
- Create: `backend/domains/finance/__init__.py`
- Create: `backend/domains/finance/schema.py`
- Create: `backend/domains/finance/service.py`
- Modify: `backend/intelligence/context.py`

**Step 1: Create domain skeleton**

Create `backend/domains/__init__.py` (empty).

Create `backend/domains/finance/__init__.py` (empty).

Create `backend/domains/finance/schema.py`:
```python
from dataclasses import dataclass, field


@dataclass
class FinancialSnapshot:
    net_worth: float | None = None
    portfolio_value: float | None = None
    portfolio_delta_today: float | None = None
    cash_balance: float | None = None
    cash_runway_months: float | None = None
    upcoming_tax_events: list[dict] = field(default_factory=list)
    subscription_burn_monthly: float | None = None
    alerts: list[dict] = field(default_factory=list)
```

Create `backend/domains/finance/service.py`:
```python
from sqlalchemy.orm import Session
from backend.domains.finance.schema import FinancialSnapshot


def build_financial_snapshot(db: Session) -> dict:
    """
    Returns the financial snapshot for the AI context.
    Phase 1: returns empty/None values as stubs.
    Phase 2: pulls real data from Manifold broker integrations and Plaid.
    """
    snapshot = FinancialSnapshot()
    return {
        "net_worth": snapshot.net_worth,
        "portfolio_value": snapshot.portfolio_value,
        "portfolio_delta_today": snapshot.portfolio_delta_today,
        "cash_balance": snapshot.cash_balance,
        "cash_runway_months": snapshot.cash_runway_months,
        "upcoming_tax_events": snapshot.upcoming_tax_events,
        "subscription_burn_monthly": snapshot.subscription_burn_monthly,
        "alerts": snapshot.alerts,
    }
```

**Step 2: Add finance to context snapshot**

In `backend/intelligence/context.py`, add import:
```python
from backend.domains.finance.service import build_financial_snapshot
```

Add to `build_context_snapshot` return dict:
```python
"finance": build_financial_snapshot(db),
```

**Step 3: Run full test suite**
```bash
uv run python -m pytest tests/ -q --tb=short 2>&1 | tail -10
```
Expected: all pass.

**Step 4: Commit**
```bash
git add backend/domains/ backend/intelligence/context.py
git commit -m "feat: finance domain skeleton — context snapshot now includes financial section"
```

---

## Verification checklist before calling Phase 1 done

Run these in order:

```bash
# 1. Full test suite
uv run python -m pytest tests/ -q 2>&1 | tail -5

# 2. Backend starts without error
uv run uvicorn backend.main:app --reload &
sleep 3
curl http://localhost:8000/health
curl http://localhost:8000/api/context | python3 -m json.tool | head -30
kill %1

# 3. Frontend builds without TypeScript errors
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected:
- All tests pass
- `/health` returns `{"status": "ok"}`
- `/api/context` returns JSON with `temporal_context` key and `finance` key
- Zero TypeScript errors

---

## Phase 2 preview (not in this plan)

- Port Manifold Coinbase + Schwab into `backend/domains/finance/service.py`
- Plaid integration for banking + subscriptions
- Cronometer integration for nutrition
- Readwise integration for learning
- LifeMap view (D3 goal tree)
- Goal decomposition engine (`intelligence/decomposer.py`)
- Finance, Health, Learning, People, Admin insight panels
- People domain (lightweight CRM from conversations)
