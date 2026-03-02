# Adaptive Scheduling Design

**Goal:** Transform Eden from a static schedule optimizer into an adaptive scheduling partner — one that proposes full days, workshops them conversationally, nudges you in real time when the day drifts, and gets genuinely smarter about you over time through behavioral data and chat memory.

**Core tension resolved:** The user shouldn't fill out a schedule like a form, but Eden shouldn't dictate their day either. The answer is a configurable autonomy spectrum: Eden proposes, explains its reasoning, and the user controls how much latitude it gets.

---

## 1. What's New

Three capabilities layered on top of the existing foundation:

1. **Planning Session** — a two-panel view (chat + live timeline) for workshopping tomorrow's schedule in under 5 minutes
2. **Live Mode** — a persistent "what now" strip on Today view that adapts as the actual day diverges from the plan
3. **Personalization Engine** — behavioral pattern extraction from usage data + memory extraction from chat conversations, both injected into every AI decision

---

## 2. Planning Session

### UX

A dedicated `/plan` route. Split-panel:
- **Left:** Chat thread with Eden. Eden opens with a brief of the proposed day and its reasoning. User edits via natural language.
- **Right:** Visual timeline in draft state. Updates in real time as chat changes come in. User can also drag blocks directly — chat acknowledges the change.

One terminal action: **[ lock in tomorrow ]** — commits all draft blocks to ScheduleBlocks and closes the session.

Target: under 5 minutes to go from proposed → locked.

### Trigger Modes

- **Automatic:** at a user-configured time each evening (e.g. 9pm), Eden generates the plan in the background. A notification badge appears on the nav. If the user doesn't open it within a configurable window, behavior depends on autonomy level (see Section 4).
- **Manual:** user opens `/plan` any time. Works for any date, not just tomorrow.
- **Replan:** from the Live Mode strip mid-day, scoped to remaining hours only.

### Plan Generation

`POST /api/plan/generate` — takes a target date, runs a structured LLM call with full context snapshot + user memory + behavioral profile. Returns proposed blocks as draft ScheduleBlocks (`is_draft = true`). No LLM call at view-open time — generation happens in the background so the view loads instantly.

The generation prompt is distinct from the chat prompt — it outputs structured JSON (list of blocks with task_id, start_time, end_time, reasoning per block) rather than conversational text.

### Planning Chat

Reuses the existing chat infrastructure but with a planning-specific system prompt. Key differences:
- Context includes the current draft state of tomorrow's schedule
- Tool set is narrowed: `move_block`, `add_block`, `remove_block`, `replace_task` — no task creation/deletion in this mode
- Every tool action updates draft ScheduleBlocks and triggers a timeline refresh on the frontend

---

## 3. Live Mode

### The "Now" Strip

A persistent strip at the top of the Today view. Always visible. Shows:

```
[ on it ]  Work on ML paper draft — 80 min until swim practice, highest urgency active task.  [ skip ]  [ not now ]
```

Three actions:
- **[ on it ]** — acknowledges, optionally starts a focus timer
- **[ skip ]** — logs the skip, surfaces next suggestion immediately
- **[ not now ]** — snoozes for 20 minutes

### Suggestion Engine

`GET /api/now` — no LLM call, pure deterministic logic. Fast and cheap. Ranks available tasks by:
1. Is something currently scheduled for this slot? If yes, surface it.
2. Otherwise: urgency score (temporal decay) × energy match (current hour vs. cognitive load) × defer penalty (tasks deferred 3+ times get a boost — they need to be dealt with).

Returns one task + one-line reason. Recalculates every time a task is completed, skipped, or a block boundary passes.

### Drift Detection

When the actual day diverges from the locked plan (3+ skips, or it's past 1pm and fewer than 30% of scheduled blocks have been touched), Eden surfaces a soft prompt:

*"Looks like the day shifted. Want to replan the rest of today?"*

One tap opens a mini planning session scoped to remaining hours. Same two-panel view, same chat → timeline flow.

---

## 4. Autonomy Spectrum

`autonomy_level: int (1–5)` on UserProfile. Controls three things: schedule generation behavior, live mode assertiveness, and auto-lock behavior.

| Level | Name | Generation | Live Mode | Auto-lock |
|-------|------|------------|-----------|-----------|
| 1 | Full AI | Auto-generates and auto-locks at configured time | Assertive, persistent nudges, auto-replans | Yes |
| 2 | AI with light review *(default)* | Auto-generates, notification sent. Auto-locks after 1hr if not opened | Active suggestions, one nudge then quiet | If not reviewed within window |
| 3 | Collaborative | Auto-generates, must be manually locked. Never auto-locks | Suggestions present, not persistent | Never |
| 4 | User-led | Eden fills only untouched blank space. User blocks dominate | Suggestions on request only ("what should I do?") | Never |
| 5 | Manual | No auto-generation. Blank canvas, Eden responds when asked | Strip hidden by default | Never |

The autonomy level is a settings toggle — not permanent, not a personality quiz. A chaotic week calls for level 4; a focused sprint calls for level 1.

---

## 5. Personalization Engine

Two data streams, both injected into every planning session and live suggestion prompt.

### Behavioral Profile (passive)

Built from existing data — LearningRecords, ScheduleBlock completion events, skip logs. Updated weekly via background job. Produces a structured set of rules:

- Estimation accuracy by cognitive load tier
- Completion rate by time of day (morning vs. afternoon vs. evening blocks)
- Defer patterns: which task categories get deferred, how often
- Schedule adherence rate by day of week

These become explicit facts prepended to the planning prompt: *"User completes deep focus tasks at 1.4x estimated duration. User follows morning blocks 82% of the time but afternoon blocks 41% — front-load important work."*

### Chat Memory (active)

After every chat interaction (planning sessions, live mode, regular chat), a background job runs a memory extraction pass. A lightweight LLM call reads the conversation and extracts anything worth persisting:

**Categories:**
- `preference` — "prefers not to schedule admin before 10am"
- `constraint` — "thesis committee meets every other Thursday"
- `goal_context` — "PhD is the real priority even if time allocation says otherwise"
- `personal` — "training for an Ironman through October"
- `signal` — "mentioned feeling burned out in early March"

Stored as `UserMemory` records with category, content, confidence score, and source. Injected into every planning context as a `<user_memory>` block above the task data.

### Memory Transparency

A **Memory** section in Settings shows all extracted facts. User can:
- Delete any fact they disagree with
- Add facts manually
- See the source (which chat session extracted it)

This matters: the user should know exactly what Eden thinks it knows about them.

### Profile Accumulation

Both streams feed a compiled `UserBehaviorProfile` — a JSON blob computed weekly and cached. Planning generation and the `GET /api/now` logic both read from it. Over time, Eden's scheduling decisions become increasingly calibrated to the specific user rather than population averages.

---

## 6. Data Model Changes

### New Tables

**`user_memory`**
```python
id: str (UUID)
category: str  # preference | constraint | goal_context | personal | signal
content: str   # human-readable fact
confidence: float  # 0.0–1.0
source: str    # chat session ID or "user" or "behavioral"
created_at: datetime
is_active: bool  # user can deactivate without deleting
```

### Modified Tables

**`schedule_blocks`** — add `is_draft: bool` (default False). Draft blocks are generated but not committed. Planning session works entirely in draft state; lock-in flips all draft blocks to committed.

**`user_profile`** — add:
- `autonomy_level: int` (default 2)
- `planning_time: str` ("HH:MM", default "21:00") — when to auto-generate the next day's plan
- `planning_auto_lock_minutes: int` (default 60) — window before auto-lock at level 1–2

---

## 7. New API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/plan/generate` | Generate draft schedule for a date |
| POST | `/api/plan/lock` | Commit draft blocks for a date |
| DELETE | `/api/plan/{date}` | Discard draft for a date |
| GET | `/api/now` | Current task suggestion (deterministic) |
| GET | `/api/memory` | List user memory facts |
| POST | `/api/memory` | Add a memory fact manually |
| DELETE | `/api/memory/{id}` | Delete a memory fact |
| PATCH | `/api/memory/{id}` | Toggle is_active |

Planning session chat reuses `POST /api/chat` with a `mode: "planning"` parameter that switches the system prompt and tool set.

---

## 8. New Frontend Routes/Components

- `/plan` — PlanningSession view (two-panel: ChatPanel + DraftTimeline)
- `NowStrip` component — persistent strip on Today view
- `MemorySection` component — added to Settings view
- `DraftTimeline` — Today's timeline in editable/draft state, accepts optimistic updates from chat actions

---

## 9. What Stays the Same

- OR-Tools scheduler runs unchanged — plan generation calls it directly
- Existing chat interface (`/chat`) remains for general queries
- All existing CRUD routes unchanged
- Whoop, GitHub integrations unchanged
- LLM context snapshot structure extended but not restructured
