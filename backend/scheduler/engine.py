from dataclasses import dataclass
from datetime import date, time, datetime, timedelta
from math import ceil

from ortools.sat.python import cp_model

from backend.scheduler.constraints import (
    TimeSlot,
    build_slot_grid,
    is_slot_blocked,
    is_recovery_slot,
    get_slot_energy,
)
from backend.scheduler.decay import compute_urgency, WEIGHT_URGENCY_ENERGY, WEIGHT_FOCUS_QUALITY, WEIGHT_CONTEXT_SWITCH, FOCUS_ENERGY_THRESHOLD

SOLVER_TIMEOUT_SECONDS: int = 30
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
    to a time slot. Hard constraints are strictly enforced; the objective
    maximizes urgency x energy fit.
    """

    def run(
        self,
        tasks: list,
        fixed_blocks: list,
        energy_profiles: list,
        availability_windows: list,
        now: datetime | None = None,
        start_date: date | None = None,
        correction_factors: dict | None = None,
        recovery_multiplier: float = 1.0,
    ) -> list[ScheduleBlockResult]:
        if now is None:
            now = datetime.utcnow()
        if start_date is None:
            start_date = now.date()

        schedulable = [
            t for t in tasks
            if getattr(t, "status", "active") in ("active", "backlog", "in_progress")
        ]
        if not schedulable:
            return []

        slots = build_slot_grid(start_date, availability_windows)
        if not slots:
            return []

        blocked_abs = {
            s.absolute_index for s in slots if is_slot_blocked(s, fixed_blocks)
        }
        recovery_abs = {
            s.absolute_index for s in slots if is_recovery_slot(s, energy_profiles)
        }
        energy_map = {
            s.absolute_index: max(1, round(get_slot_energy(s, energy_profiles) * recovery_multiplier))
            for s in slots
        }

        cf = correction_factors or {}
        units_per_task = [
            max(1, ceil(t.estimated_minutes * cf.get(t.cognitive_load, 1.0) / 30))
            for t in schedulable
        ]

        urgency_scores = []
        for t in schedulable:
            u = compute_urgency(
                base_priority=1.0,
                deadline=t.deadline,
                created_at=t.created_at,
                now=now,
            )
            urgency_scores.append(int(u * SCORE_SCALE))

        model = cp_model.CpModel()
        n_tasks = len(schedulable)
        n_slots = len(slots)

        x = [
            [model.NewBoolVar(f"x_{t}_{s}") for s in range(n_slots)]
            for t in range(n_tasks)
        ]

        # Hard 1: each task fills exactly units_per_task slots
        for t in range(n_tasks):
            model.Add(sum(x[t][s] for s in range(n_slots)) == units_per_task[t])

        # Hard 2: each slot holds at most one task unit
        for s in range(n_slots):
            model.Add(sum(x[t][s] for t in range(n_tasks)) <= 1)

        # Hard 3: blocked slots
        for s, slot in enumerate(slots):
            if slot.absolute_index in blocked_abs:
                for t in range(n_tasks):
                    model.Add(x[t][s] == 0)

        # Hard 4: recovery slots (only cognitive_load=1 allowed)
        for s, slot in enumerate(slots):
            if slot.absolute_index in recovery_abs:
                for t, task in enumerate(schedulable):
                    if task.cognitive_load > 1:
                        model.Add(x[t][s] == 0)

        # Hard 5: deadline enforcement
        for t, task in enumerate(schedulable):
            if task.deadline is None:
                continue
            for s, slot in enumerate(slots):
                slot_end_dt = datetime.combine(slot.date, slot.end_time)
                if slot_end_dt > task.deadline:
                    model.Add(x[t][s] == 0)

        # Hard 6: dependency ordering
        # For dependency (B depends on A): all of A's slots must precede all of B's slots.
        # Enforce: x[a][s_a] + x[b][s_b] <= 1 whenever abs_index(s_a) >= abs_index(s_b)
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
                        # Only constrain slot pairs within the same 7-day window (avoids O(n^2) explosion)
                        if abs(slots[s_a].absolute_index - abs_b) < 7 * 48:
                            if slots[s_a].absolute_index >= abs_b:
                                model.Add(x[a_idx][s_a] + x[b_idx][s_b] <= 1)

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
        project_ids = [getattr(task, 'project_id', None) for task in schedulable]
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

        solver = cp_model.CpSolver()
        solver.parameters.random_seed = 42
        solver.parameters.num_search_workers = 1
        solver.parameters.max_time_in_seconds = SOLVER_TIMEOUT_SECONDS

        status = solver.Solve(model)

        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return []

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
