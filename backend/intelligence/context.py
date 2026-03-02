from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord
from backend.scheduler.decay import compute_urgency

_72H = timedelta(hours=72)
_24H = timedelta(hours=24)


def build_context_snapshot(db: Session, now: datetime | None = None) -> dict:
    """
    Build the full context snapshot passed to the LLM on every call.
    Never call the LLM without this snapshot.
    """
    if now is None:
        now = datetime.utcnow()

    return {
        "goals": _build_goals(db),
        "projects": _build_projects(db),
        "tasks": _build_tasks(db, now),
        "schedule": _build_schedule(db, now),
        "energy_profile": _build_energy_profile(db, now),
        "learning_summary": _build_learning_summary(db),
        "alerts": _build_alerts(db, now),
        "user_profile": _build_user_profile(db),
        "whoop_today": _build_whoop_today(db, now),
    }


def _build_goals(db: Session) -> list[dict]:
    goals = db.query(Goal).filter(Goal.status.in_(["active", "paused"])).all()
    return [_serialize_goal(g) for g in goals]


def _build_projects(db: Session) -> list[dict]:
    projects = db.query(Project).filter(Project.status.in_(["active", "paused"])).all()
    return [_serialize_project(p) for p in projects]


def _build_tasks(db: Session, now: datetime) -> dict:
    cutoff_72h = now + _72H
    all_tasks = db.query(Task).filter(Task.status.notin_(["done", "dropped"])).all()

    due_soon, active, backlog, deferred = [], [], [], []

    for task in all_tasks:
        serialized = _serialize_task(task, now)
        if task.status == "deferred":
            deferred.append(serialized)
        elif task.status == "in_progress":
            active.append(serialized)
        elif task.deadline and task.deadline <= cutoff_72h:
            due_soon.append(serialized)
        else:
            backlog.append(serialized)

    backlog.sort(key=lambda t: t["urgency_score"], reverse=True)
    due_soon.sort(key=lambda t: t.get("deadline") or "")

    return {"due_soon": due_soon, "active": active, "backlog": backlog, "deferred": deferred}


def _build_schedule(db: Session, now: datetime) -> dict:
    today = now.date()
    week_end = today + timedelta(days=7)

    all_blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= today,
        ScheduleBlock.date < week_end,
    ).all()

    return {
        "today": [_serialize_block(b) for b in all_blocks if b.date == today],
        "week": [_serialize_block(b) for b in all_blocks],
    }


def _build_energy_profile(db: Session, now: datetime) -> dict:
    dow = now.weekday()
    profiles = db.query(EnergyProfile).filter(EnergyProfile.day_of_week == dow).all()
    hourly = {
        str(p.hour_of_day): {
            "energy_level": p.energy_level,
            "is_post_hard_workout": p.is_post_hard_workout,
            "notes": p.notes,
        }
        for p in profiles
    }
    return {"today_day_of_week": dow, "hourly": hourly}


def _build_learning_summary(db: Session) -> dict:
    records = db.query(LearningRecord).all()
    if not records:
        return {"total_records": 0, "avg_duration_ratio": 1.0, "overestimate_rate": 0.0, "underestimate_rate": 0.0}

    ratios = [r.actual_minutes / r.estimated_minutes for r in records]
    n = len(ratios)

    by_load: dict[int, list[float]] = {1: [], 2: [], 3: []}
    for r in records:
        load = r.task.cognitive_load if r.task else 2
        if load in by_load:
            by_load[load].append(r.actual_minutes / r.estimated_minutes)

    return {
        "total_records": n,
        "avg_duration_ratio": round(sum(ratios) / n, 3),
        "overestimate_rate": round(sum(1 for r in ratios if r < 1.0) / n, 3),
        "underestimate_rate": round(sum(1 for r in ratios if r > 1.0) / n, 3),
        "by_cognitive_load": {
            str(load): {
                "samples": len(rs),
                "avg_ratio": round(sum(rs) / len(rs), 3),
            }
            for load, rs in by_load.items()
            if rs
        },
    }


def _build_whoop_today(db: Session, now: datetime) -> dict | None:
    from backend.models.whoop_daily import WhoopDaily
    today = now.date()
    daily = db.query(WhoopDaily).filter(WhoopDaily.date == today).first()
    if not daily:
        return None
    rec = daily.recovery_score
    recommendation = "green" if rec and rec >= 67 else ("yellow" if rec and rec >= 34 else "red") if rec else None
    return {
        "recovery_score": daily.recovery_score,
        "hrv_rms": daily.hrv_rms,
        "resting_hr": daily.resting_hr,
        "sleep_quality_score": daily.sleep_quality_score,
        "strain_score": daily.strain_score,
        "actual_wake_time": daily.actual_wake_time.strftime("%H:%M") if daily.actual_wake_time else None,
        "recommendation": recommendation,
    }


def _build_user_profile(db: Session) -> dict:
    from backend.models.user_profile import UserProfile
    profile = db.query(UserProfile).first()
    if not profile:
        return {"wake_hour": 7, "chronotype": "intermediate"}
    return {"wake_hour": profile.wake_hour, "chronotype": profile.chronotype}


def _build_alerts(db: Session, now: datetime) -> list[dict]:
    alerts = []
    cutoff_24h = now + _24H

    tasks = db.query(Task).filter(
        Task.deadline.isnot(None),
        Task.status.notin_(["done", "dropped"]),
    ).all()

    for task in tasks:
        if task.deadline <= now:
            alerts.append({
                "type": "past_deadline",
                "severity": "critical",
                "task_id": task.id,
                "message": f"'{task.title}' is past its deadline.",
            })
        elif task.deadline <= cutoff_24h:
            hours_left = int((task.deadline - now).total_seconds() / 3600)
            alerts.append({
                "type": "due_soon",
                "severity": "high",
                "task_id": task.id,
                "message": f"'{task.title}' is due in {hours_left}h.",
            })

    return alerts


def _serialize_goal(goal: Goal) -> dict:
    return {
        "id": goal.id, "title": goal.title, "tier": goal.tier,
        "weight": goal.weight, "target_date": str(goal.target_date),
        "status": goal.status, "parent_id": goal.parent_id,
    }


def _serialize_project(project: Project) -> dict:
    return {
        "id": project.id, "title": project.title, "category": project.category,
        "goal_id": project.goal_id, "priority_score": project.priority_score,
        "status": project.status, "estimated_hours_remaining": project.estimated_hours_remaining,
        "github_repo": project.github_repo,
    }


def _serialize_task(task: Task, now: datetime) -> dict:
    urgency = compute_urgency(
        base_priority=1.0, deadline=task.deadline, created_at=task.created_at, now=now,
    )
    return {
        "id": task.id, "title": task.title, "project_id": task.project_id,
        "status": task.status, "cognitive_load": task.cognitive_load,
        "estimated_minutes": task.estimated_minutes, "actual_minutes": task.actual_minutes,
        "deadline": str(task.deadline) if task.deadline else None,
        "urgency_score": round(urgency, 4),
        "dependency_ids": [d.id for d in task.dependencies],
        "source": task.source,
    }


def _serialize_block(block: ScheduleBlock) -> dict:
    return {
        "id": block.id, "task_id": block.task_id,
        "date": str(block.date), "start_time": str(block.start_time),
        "end_time": str(block.end_time), "auto_generated": block.auto_generated,
        "overridden_by_user": block.overridden_by_user,
    }
