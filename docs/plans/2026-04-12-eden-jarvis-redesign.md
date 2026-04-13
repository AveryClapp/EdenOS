# Eden — Jarvis Redesign
**Date**: 2026-04-12  
**Status**: Approved for implementation

---

## The Vision

Eden is not a task manager. It is not a dashboard. It is an ambient intelligence that holds your life in its head — omniscient, proactive, and always reasoning.

The reference point is Jarvis from Marvel: a system that knows who you are, what you're working toward, and what's happening across every dimension of your life simultaneously. It speaks when it has something worth saying. It meets you wherever you are in your day. It never requires a ritual.

**The core principle: Eden never mirrors, Eden synthesizes.**

Every data source — WHOOP, Manifold, GitHub, Google Calendar, Plaid, Cronometer, Readwise — feeds Eden's reasoning engine. Eden does not display that data the way the source app does. It renders what the data *means* in the context of your goals, your schedule, your finances, your body, and your history. You go to WHOOP to see your WHOOP data. You go to Eden to understand what it means.

---

## Core Philosophy

### Ambient, not ritual-dependent
Eden is always running in the background from passive data sources. When you arrive — at 7am, at 4pm, after 3 days away — Eden has already formed a view of the current state of your life. It meets you in the moment. No mandatory morning check-in. No required workflow. If you show up at 4pm, Eden sees the day is mostly done, asks how it went, updates its model from what you tell it, and pivots to tomorrow.

### Every session starts with temporal assessment
Before Eden says anything, it assesses: what time is it, what's happened today that it can see from passive data, what's the next meaningful horizon. That assessment shapes everything it says and surfaces. 7am Eden and 4pm Eden behave completely differently.

### Conversational structure, not form-based structure
Eden learns from talking to you. Goals, projects, tasks, relationships, constraints — all of it emerges from conversation. Eden asks clarifying questions, proposes structure, waits for your approval before writing anything. No forms. The structured data exists in the database but you never touch it directly.

### Cross-domain reasoning is the product
The value Eden provides is reasoning that no single-domain app can replicate. "Your recovery has trended down 4 consecutive days, which coincides with your heaviest scheduling week — and you have your most important deadline in 11 days. Here's what I'd change." That sentence requires WHOOP data, schedule data, and goal data simultaneously. That is the thing Eden does.

### Insight surfaces, not data displays
Every panel Eden shows is an interpretation, not a mirror. Numbers appear only when they carry meaning. Visualizations show patterns and implications, not raw metrics.

---

## Domain Model

Eden maintains a complete model across every dimension of your life:

```
Eden
├── Life        — goal tree, projects, tasks, goal decomposition
├── Schedule    — today, week, month — AI-generated from full context
├── Finance     — net worth, portfolio, cash flow, tax events (via Manifold + Plaid)
├── Health      — recovery capacity, strain trend, sleep quality (via WHOOP)
├── Body        — nutrition, macros, fueling relative to training (via Cronometer)
├── Learning    — reading, highlights, knowledge connected to goals (via Readwise)
├── People      — key relationships, touchpoints, commitments, what's pending
├── Admin       — bills, subscriptions, renewals, recurring life tasks (via Plaid)
└── Identity    — who you are: values, tendencies, working style, history, constraints
```

---

## Data Sources & Integration Strategy

One authoritative source per domain. Eden reads it, never replaces it.

| Domain | Source | Integration |
|--------|--------|-------------|
| Goals / Tasks | Eden-native | Conversational intake + AI decomposition |
| Calendar | Google Calendar + Outlook | Bidirectional sync, existing integration |
| Code | GitHub | Read-only, existing integration |
| Health | WHOOP | Read-only — recovery, HRV, strain, sleep |
| Finance (investments) | Manifold (Coinbase + Schwab) | Port broker logic into `backend/finance/` |
| Finance (banking) | Plaid | Read-only — accounts, balances, recurring charges |
| Body | Cronometer API | Daily macros, meals, targets |
| Learning | Readwise API | Highlights, books, articles |
| People | Eden-native | Lightweight CRM built from conversations |
| Admin | Plaid + Eden-native | Plaid identifies subscriptions; Eden tracks one-offs |
| Identity | Eden-native | Built continuously from all domains + conversation |

**New integrations to build**: Plaid, Cronometer, Readwise. Email (Gmail/Outlook read) as a future signal for commitment extraction.

---

## Identity Model

Eden maintains a persistent, evolving model of who you are — not just what you're doing.

```
Identity
├── Core profile     — chronotype, cognitive peaks, working style, wake time
├── Life domains     — which areas you operate in and their relative weight
├── Values           — what you've said matters, inferred from goal weights + decisions
├── Tendencies       — where you underestimate, defer, overcommit (from learning records)
├── Relationships    — key people: role, collaboration status, last touchpoint, pending items
├── Constraints      — non-negotiables, recovery needs, financial floor, hard limits
├── Skills           — what you're strong at, what you're actively building
└── History          — decisions made, outcomes observed, patterns confirmed
```

This model is built from every interaction and every data source. It is never shown as a structured form. It lives in Eden's context and shapes every response.

---

## Goal Decomposition Engine

One of the three core gaps in the current system. You should be able to say "I want to become a competitive ML researcher" and have Eden turn that into a real plan.

**The flow:**

1. You express an aspiration in conversation — vague is fine
2. Eden asks one clarifying question at a time to understand scope, timeline, constraints
3. Eden proposes a decomposition: long-term goal → mid-term milestones → projects → tasks
4. You approve, reshape, or reject each level
5. Eden writes nothing until you've confirmed it
6. The goal appears in the Life Map immediately

**Decomposition is grounded in reality:**
- Current bandwidth (how many open tasks across active projects)
- Existing commitments (calendar density, other goals)
- Deadline math (working backward from target date)
- Your historical performance ratios (from learning records — if you consistently underestimate deep work tasks by 40%, Eden accounts for that)

**Decomposition is recursive:** mid-term goals can themselves be decomposed. Projects can be broken into phases. Eden proposes, you confirm.

---

## Intelligence Layer

### Context snapshot
Every AI call receives the full context snapshot across all domains. Partial context is never used. The snapshot includes:

```python
{
  "identity": {...},           # full identity model
  "goals": [...],              # active goal tree with weights
  "projects": [...],           # active projects with priority scores
  "tasks": {
    "due_soon": [...],
    "active": [...],
    "backlog": [...],
    "deferred": [...]
  },
  "schedule": {
    "today": [...],
    "week": [...],
    "month": [...]
  },
  "finance": {
    "net_worth": ...,
    "portfolio_delta_today": ...,
    "upcoming_tax_events": [...],
    "cash_runway_months": ...,
    "subscription_burn_monthly": ...
  },
  "health": {
    "recovery_today": ...,
    "recovery_trend_7d": [...],
    "strain_trend_7d": [...],
    "cross_domain_flags": [...]  # e.g. low recovery + heavy schedule
  },
  "body": {
    "macro_target_vs_actual": {...},
    "fueling_relative_to_strain": ...
  },
  "learning": {
    "active_reading": [...],
    "recent_highlights": [...],
    "goal_connections": [...]    # highlights connected to active goals
  },
  "people": {
    "relationships": [...],
    "pending_commitments": [...],
    "cold_relationships": [...]
  },
  "admin": {
    "upcoming_bills": [...],
    "unused_subscriptions": [...],
    "expiring_items": [...]
  },
  "alerts": [...],
  "temporal_context": {
    "time_of_day": ...,
    "day_phase": "morning|afternoon|evening|night",
    "days_since_last_session": ...,
    "what_eden_saw_passively": [...]
  }
}
```

### Proactive intelligence
Eden surfaces things unprompted when they cross a relevance threshold:

- **Cross-domain conflicts**: "You have 6h of deep work scheduled Thursday but your recovery has trended below 60% for 4 days."
- **Financial flags**: "The Coinbase gains from March create a $2,400 tax event in 3 weeks — nothing set aside yet."
- **Goal drift**: "You haven't worked on your fitness goal in 9 days."
- **Pattern recognition**: "You consistently underestimate ML research tasks by 40%. I've adjusted this week's estimates."
- **Relationship maintenance**: "You haven't spoken with [person] in 6 weeks — last you mentioned, you were waiting on them for something."
- **Commitment aging**: "You told [person] you'd send the draft 'by end of week' — that was 10 days ago."

### Proactive rituals (offered, never required)
- **Morning brief** — synthesizes overnight data, sets the day
- **Weekly review** — what got done, what didn't, where time went, financial changes, health trends, goal progress
- **Monthly life review** — broader patterns, domain balance, goal trajectory
- **Quarterly planning** — goal tree review, what's done/stale/needs adding
- **Pre-meeting prep** — 15 min before important meetings, Eden briefs you
- **Evening debrief** — what happened, what carries over, tomorrow's load

All rituals adapt to whether you actually show up for them. Eden doesn't require them.

### Adaptive rescheduling
When passive data indicates a day isn't going as planned — low WHOOP recovery, calendar chaos, task completions that don't match the schedule — Eden proactively proposes adjustments. You approve or ignore.

---

## Dashboard & Visualization

### Aesthetic
Dark, dense, alive. A cockpit, not a productivity app. Information rendered at the intelligence of its audience. No gamification. No color-coded labels for their own sake. Everything that appears means something.

### Global layout

```
┌─────────────────────────────────────────────────────────────────────┐
│ AMBIENT BAR: 4:12pm · Recovery 71%↓ · Portfolio +$340 · 3 alerts   │
├──────┬──────────────────────────────────────────┬───────────────────┤
│      │                                          │                   │
│ NAV  │            MAIN PANEL                   │      EDEN         │
│      │   (Eden decides what surfaces here)     │                   │
│  ◉   │                                          │  Speaks first.    │
│  ◉   │                                          │  Always open.     │
│  ◉   │                                          │  Voice + text.    │
│  ◉   │                                          │  Stateful.        │
│  ◉   │                                          │                   │
│  ◉   │                                          │                   │
│  ◉   │                                          │                   │
└──────┴──────────────────────────────────────────┴───────────────────┘
```

**Ambient bar** — one line, always visible. Current time, recovery status with trend arrow, portfolio delta since yesterday, unread alert count. Tells you if anything needs attention before you've done anything.

**Nav sidebar** — one icon per domain. Subtle health indicator per domain: green (nothing needs attention), yellow (Eden has a flag), red (requires action). You know if any domain is in trouble without opening it.

**Eden panel** — always open on the right. Eden speaks first on arrival. Chat is persistent and stateful across sessions. Voice input available. Collapsible but never absent.

### Panels

**Command Center (home)**
Eden-generated, not a fixed widget grid. Eden decides what surfaces based on temporal context. At 7am: one priority for the day, schedule overview, financial pulse if anything flagged, recovery implication. At 4pm: how the day went vs. plan, what's carrying over, tomorrow's setup. The layout changes. Eden curates it.

**Life Map**
The goal tree as a living graph. Long-term goals at the top, mid-term milestones below, projects and tasks at the leaves. Populated entirely from conversations with Eden. Node size reflects priority weight. Color intensity reflects urgency and staleness — a goal with no active tasks in 2 weeks visually fades. Zooming out shows balance across your life. Zooming in shows task-level detail. This is the view that makes neglect visible.

**Schedule (Day / Week / Month)**
Three temporal views on a single continuum. All read-only outputs — Eden generated them, you negotiate changes through conversation.

- *Day*: timeline with Eden's task blocks, calendar events, energy profile as a heat gradient underneath. Shows what's done, active, and coming.
- *Week*: 7-column grid with domain color coding, cognitive load indicators, energy profile overlay.
- *Month*: goal milestones, financial events (tax deadlines, subscription charges, options expiry), health trend markers overlaid on a calendar.

**Finance**
Not a portfolio tracker. An interpretation of your financial health in context.
- Net worth at the top (investments + cash − liabilities), updated daily
- Trend: are you on track for your financial goals given current trajectory?
- Flags: upcoming tax events, unusual spend, subscriptions costing more than you're getting
- Cash runway in months
- Manifold's full broker data and FIFO accounting underneath, but surfaced as insight not as tables

**Health**
Not a WHOOP clone. What your body means for your life today.
- Effective capacity: given today's recovery and this week's strain trend, what's your real cognitive and physical bandwidth?
- How Eden has already adjusted today's schedule in response
- Cross-domain observations: "4 consecutive days under 75% recovery correlates with your scheduling pattern last week"
- Nutrition relative to training load if Cronometer is connected

**Learning**
Not a highlight viewer. What you're absorbing and how it connects.
- Active reading with estimated completion
- Recent highlights surfaced by relevance to current goals
- Connections Eden has noticed: "This paper connects to your research goal — want to schedule synthesis time?"
- Knowledge gaps: areas your active goals require that you haven't been reading toward

**People**
Not a contact list. A relationship graph.
- Key people rendered with context: role, active collaboration, last meaningful touchpoint
- Pending items: things you owe them, things they owe you
- Commitments Eden extracted from your conversations that haven't been resolved
- Cold flags: relationships that matter that are going quiet

**Admin**
Not a bill tracker. A life overhead surface.
- Every recurring charge identified from Plaid with annual cost
- Unused subscriptions flagged
- Upcoming renewals and expirations
- One-off life tasks Eden is tracking

### Interaction principles
- Hover anything → ask Eden about it inline, without leaving the panel
- Every number is a conversation starter, not a dead metric
- Eden can take over the main panel to present something it thinks you need to see
- No forms anywhere — if Eden needs data it asks in the chat
- The system is fully functional at whatever depth you engage with it on any given day

---

## Architecture

### Backend
```
backend/
├── domains/
│   ├── life/           # goals, projects, tasks, decomposition engine
│   ├── schedule/       # OR-Tools optimizer, blocks, decay
│   ├── finance/        # Manifold broker logic, Plaid, net worth
│   ├── health/         # WHOOP integration, capacity modeling
│   ├── body/           # Cronometer integration
│   ├── learning/       # Readwise integration
│   ├── people/         # relationship CRM
│   └── admin/          # subscription tracking, life tasks
├── intelligence/
│   ├── context.py      # full cross-domain context snapshot builder
│   ├── prompts.py      # all system prompts
│   ├── client.py       # Claude API client
│   ├── decomposer.py   # goal decomposition engine
│   └── memory.py       # identity model, behavioral profile
├── integrations/
│   ├── gcal.py
│   ├── outlook.py
│   ├── github.py
│   ├── whoop.py
│   ├── plaid.py        # new
│   ├── cronometer.py   # new
│   └── readwise.py     # new
├── api/                # FastAPI routers per domain
├── models/             # SQLAlchemy ORM
├── db.py               # PostgreSQL connection
└── main.py
```

**Database**: Upgrade from SQLite to PostgreSQL. Handles both Eden's real-time patterns and Finance's complex FIFO queries without compromise.

### Frontend
```
frontend/src/
├── views/
│   ├── CommandCenter.tsx   # home — Eden-generated layout
│   ├── LifeMap.tsx         # goal tree visualization
│   ├── Schedule.tsx        # day/week/month
│   ├── Finance.tsx         # financial health panel
│   ├── Health.tsx          # body capacity panel
│   ├── Learning.tsx        # knowledge panel
│   ├── People.tsx          # relationship graph
│   └── Admin.tsx           # life overhead panel
├── components/
│   ├── AmbientBar.tsx      # top status bar
│   ├── NavSidebar.tsx      # domain nav with health indicators
│   ├── EdenPanel.tsx       # always-open chat/voice interface
│   └── ...
└── api/                    # backend API client
```

Stack: React + TypeScript + Vite (existing), Tailwind v4 (existing). Add D3 or Recharts for the Life Map graph visualization.

---

## What Changes From Current Eden

| Current | New |
|---------|-----|
| SQLite | PostgreSQL |
| Forms for goals/tasks | Conversational intake only |
| Chat as one view | Chat always open on the right |
| Health as WHOOP data display | Health as capacity interpretation |
| Finance not integrated | Manifold logic ported into `domains/finance/` |
| Context snapshot: goals + tasks + schedule + energy | Context snapshot: all 8 domains + identity |
| Static panels | Eden-curated Command Center |
| Manual goal entry | Goal decomposition engine |
| No Plaid / Cronometer / Readwise | All three integrated |
| Morning brief as a feature | Ambient session assessment — Eden adapts to when you arrive |

---

## What Does NOT Change

- Temporal decay formula and scheduler core (OR-Tools, `decay.py`, `constraints.py`)
- Manual override immutability (`overridden_by_user = true`)
- Learning records (append-only)
- GCal + Outlook bidirectional sync
- GitHub read-only import
- All API keys server-side only
- Frontend derives state from backend only
- Alembic for all schema changes

---

## Out of Scope (v1)

- Voice interface (architecture supports it, not built yet)
- Email inbox reading (future signal for commitment extraction)
- Mobile app
- Multi-user
- Social / sharing features
- Gamification of any kind
