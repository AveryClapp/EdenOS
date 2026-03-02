from datetime import datetime

from sqlalchemy.orm import Session

from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.scheduler.decay import compute_urgency


def recompute_all_priorities(db: Session, now: datetime | None = None) -> None:
    """
    Update priority_score on every active/paused project.

    Score = goal_weight * max_task_urgency (or goal_weight * 0.1 if no open tasks).

    Higher goal weight and more urgent tasks → higher priority.
    """
    if now is None:
        now = datetime.utcnow()

    projects = db.query(Project).filter(Project.status.in_(["active", "paused"])).all()
    goal_map: dict[str, Goal] = {g.id: g for g in db.query(Goal).all()}
    task_map: dict[str, list[Task]] = {}

    open_tasks = (
        db.query(Task)
        .filter(Task.status.notin_(["done", "dropped"]))
        .all()
    )
    for t in open_tasks:
        task_map.setdefault(t.project_id, []).append(t)

    for project in projects:
        goal = goal_map.get(project.goal_id)
        goal_weight = goal.weight if goal else 1.0

        tasks = task_map.get(project.id, [])
        active_tasks = [t for t in tasks if t.status not in ("deferred",)]

        if not active_tasks:
            project.priority_score = round(goal_weight * 0.1, 4)
            continue

        max_urgency = max(
            compute_urgency(1.0, t.deadline, t.created_at, now)
            for t in active_tasks
        )
        project.priority_score = round(goal_weight * max_urgency, 4)

    db.commit()
