from datetime import datetime, date, time

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.models.energy_profile import EnergyProfile
from backend.scheduler.decay import compute_urgency

router = APIRouter(prefix="/api/now", tags=["now"])


def _current_energy(db: Session, now: datetime) -> int:
    profile = db.query(EnergyProfile).filter(
        EnergyProfile.hour_of_day == now.hour,
        EnergyProfile.day_of_week == now.weekday(),
    ).first()
    return profile.energy_level if profile else 3


def _score_task(task: Task, energy: int, defer_counts: dict) -> float:
    urgency = 1.0
    if task.deadline:
        try:
            urgency = compute_urgency(
                base_priority=1.0,
                deadline=task.deadline,
                created_at=task.created_at,
            )
        except Exception:
            urgency = 1.0

    # Energy match: prefer tasks whose cognitive load matches current energy
    load = task.cognitive_load or 2
    if energy >= 4 and load == 3:
        energy_match = 1.5
    elif energy <= 2 and load == 1:
        energy_match = 1.3
    elif energy >= 4 and load < 3:
        energy_match = 0.8  # underusing high energy
    else:
        energy_match = 1.0

    defer_boost = 1.0 + (0.1 * min(defer_counts.get(task.id, 0), 5))

    return urgency * energy_match * defer_boost


@router.get("")
def get_now_suggestion(db: Session = Depends(get_db)):
    now = datetime.now()  # local time
    today = date.today()
    now_time = now.time()

    # Check if there's a committed block scheduled for right now
    current_block = db.query(ScheduleBlock).filter(
        ScheduleBlock.date == today,
        ScheduleBlock.start_time <= now_time,
        ScheduleBlock.end_time > now_time,
        ScheduleBlock.is_draft == False,
        ScheduleBlock.task_id.isnot(None),
    ).first()

    if current_block:
        task = db.get(Task, current_block.task_id)
        if task:
            return {
                "task": _serialize_task(task),
                "reason": "Currently scheduled for this time block.",
                "suggested_at": now.isoformat(),
            }

    # No current block — rank active/backlog tasks
    tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()

    if not tasks:
        return {"task": None, "reason": "No active tasks.", "suggested_at": now.isoformat()}

    energy = _current_energy(db, now)
    defer_counts: dict = {}  # future: load from skip logs

    scored = sorted(tasks, key=lambda t: _score_task(t, energy, defer_counts), reverse=True)
    best = scored[0]

    # Build reason
    reasons = []
    if best.deadline:
        days_left = (best.deadline.date() - today).days if hasattr(best.deadline, "date") else None
        if days_left is not None and days_left <= 3:
            reasons.append(f"deadline in {days_left} day{'s' if days_left != 1 else ''}")
    if energy >= 4 and best.cognitive_load == 3:
        reasons.append("high energy window — good for deep focus")
    reasons.append("highest priority active task")
    reason = ", ".join(reasons[:2]).capitalize() + "."

    return {
        "task": _serialize_task(best),
        "reason": reason,
        "suggested_at": now.isoformat(),
    }


def _serialize_task(task: Task) -> dict:
    return {
        "id": task.id,
        "title": task.title,
        "project_id": task.project_id,
        "cognitive_load": task.cognitive_load,
        "estimated_minutes": task.estimated_minutes,
        "status": task.status,
        "deadline": task.deadline.isoformat() if task.deadline else None,
    }
