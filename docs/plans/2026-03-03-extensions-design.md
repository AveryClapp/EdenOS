# Eden Extensions Design
Date: 2026-03-03

## Four features

### 1. Explainability layer
After each scheduler run, a single background Claude call receives the full schedule and produces:
- A one-paragraph narrative summary of the day's key decisions
- A `reasoning` string per block (energy fit, urgency, dependency state)

Storage: new `PlanExplanation` table (id, date, summary, full_reasoning JSON) + `reasoning` column on `schedule_blocks`.
API: `GET /api/schedule/explanation?date=YYYY-MM-DD`
Frontend: collapsible "Why this schedule?" strip in Today view, below the header.
Does not block the scheduler response — runs as a background task.
One Alembic migration covers both schema changes.

### 2. Multi-objective Pareto optimization
Three explicit objective terms added to the CP-SAT solver (weighted scalarization):
1. **Deadline adherence** — urgency-weighted cost for tasks not scheduled close to deadline
2. **Focus quality** — penalty for placing cognitive_load=3 tasks in low-energy slots
3. **Context switching** — penalty for consecutive blocks from different projects

Weights are configurable constants in `scheduler/decay.py`. Context switching penalty requires tracking adjacent block pairs and adding inter-block penalty terms to the objective.
Changes confined to `scheduler/engine.py` and `scheduler/constraints.py`. No schema changes.

### 3. Hierarchical goal inference
After each scheduler run, checks every active goal. If a goal has fewer than 3 non-done tasks across its projects, it's flagged as "thin." For each thin goal, a Claude call generates 3–5 concrete next tasks (title, estimated_minutes, cognitive_load, project_id) as `ProposedAction` objects.

Surfaces as a new alert type in `AlertStrip`: "Goal X needs new tasks → Review." Approval uses the existing `execute_tool` path. One new file: `backend/intelligence/goal_inference.py`. No schema changes.

### 4. RL data collection infrastructure
New table `rl_episode`:
- `id`, `scheduled_at`, `state` (JSON), `action` (JSON), `reward` (float|null), `reward_computed_at`, `episode_complete`

State: task features (cognitive_load, urgency, dependencies_unblocked, estimated_minutes), energy profile for scheduled window, day/time context.
Action: list of `{task_id, date, start_time, end_time}`.
Reward: computed lazily by background job. Formula: `+completion_quality/5` for done, `+0.3` for accurate duration estimate, `-0.5` for deadline miss, normalized to [-1, 1].

One new file: `backend/intelligence/rl_collector.py` (`record_episode`, `compute_rewards`).
`record_episode` called at end of `_run_scheduler_job`. `compute_rewards` runs every 30 min in background loop.
One Alembic migration. No frontend changes.

## Implementation order
1. Explainability (most user-visible, no schema risk)
2. Multi-objective optimization (scheduler core, self-contained)
3. Hierarchical goal inference (intelligence layer)
4. RL data collection (instrumentation last, captures improved scheduler decisions)

## Schema changes summary
- `schedule_blocks`: add `reasoning TEXT NULL`
- new table: `plan_explanations` (id, date, summary, full_reasoning JSON, created_at)
- new table: `rl_episodes` (id, scheduled_at, state JSON, action JSON, reward FLOAT NULL, reward_computed_at DATETIME NULL, episode_complete BOOL)
- One migration file covers all three changes
