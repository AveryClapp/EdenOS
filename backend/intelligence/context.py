from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord
from backend.scheduler.decay import compute_urgency
from backend.intelligence.behavioral_profile import build_behavioral_profile
from backend.intelligence.temporal import get_temporal_context

_72H = timedelta(hours=72)
_24H = timedelta(hours=24)


def build_context_snapshot(db: Session, now: datetime | None = None) -> dict:
    """
    Build the full context snapshot passed to the LLM on every call.
    Never call the LLM without this snapshot.
    """
    if now is None:
        now = datetime.now()  # local time — temporal context must reflect the user's timezone

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
        "behavioral_profile": build_behavioral_profile(db),
        "user_memory": _build_user_memory(db),
        "people": _build_people(db, now),
        "temporal_context": get_temporal_context(now),
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


def _build_user_memory(db: Session) -> list[dict]:
    from backend.models.user_memory import UserMemory
    memories = (
        db.query(UserMemory)
        .filter(UserMemory.is_active == True)
        .order_by(UserMemory.observation_count.desc().nullslast())
        .all()
    )
    return [
        {
            "category": m.category,
            "content": m.content,
            "confidence": m.confidence,
            "observation_count": m.observation_count or 1,
        }
        for m in memories
    ]


def _build_people(db: Session, now: datetime) -> dict:
    from backend.models.person import Person
    from backend.models.commitment import Commitment
    from datetime import timedelta

    stale_threshold = now.date() - timedelta(days=30)

    people = db.query(Person).filter(Person.is_active == True).all()

    result = []
    for p in people:
        open_commitments = [
            c for c in p.commitments if c.status == "open"
        ]
        is_stale = (p.last_contact_date is None) or (p.last_contact_date < stale_threshold)
        result.append({
            "id": p.id,
            "name": p.name,
            "relationship_type": p.relationship_type,
            "last_contact_date": str(p.last_contact_date) if p.last_contact_date else None,
            "stale": is_stale,
            "open_commitments": [
                {"id": c.id, "description": c.description, "due_date": str(c.due_date) if c.due_date else None}
                for c in open_commitments
            ],
        })

    return {"people": result}


def _build_alerts(db: Session, now: datetime) -> list[dict]:
    alerts = []
    cutoff_24h = now + _24H

    # Recovery alert: if WHOOP is red/yellow AND cognitive_load=3 tasks are scheduled today
    try:
        from backend.models.whoop_daily import WhoopDaily
        from backend.models.schedule_block import ScheduleBlock as SB
        today_whoop = db.query(WhoopDaily).filter(WhoopDaily.date == now.date()).first()
        if today_whoop and today_whoop.recovery_score is not None:
            rec = today_whoop.recovery_score
            if rec < 34:
                severity, label = "high", "red"
            elif rec < 67:
                severity, label = "medium", "yellow"
            else:
                severity, label = None, None

            if severity:
                # Check if any deep-work blocks exist today
                today_blocks = db.query(SB).filter(SB.date == now.date(), SB.is_draft == False).all()
                task_ids = [b.task_id for b in today_blocks if b.task_id]
                if task_ids:
                    deep_tasks = db.query(Task).filter(
                        Task.id.in_(task_ids),
                        Task.cognitive_load == 3,
                    ).count()
                    if deep_tasks > 0 or rec < 34:
                        alerts.append({
                            "type": "low_recovery",
                            "severity": severity,
                            "message": f"Recovery is {label} ({rec}%) — schedule adapted, deep work load reduced.",
                        })
    except Exception:
        pass

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

    # Thin goal alerts: goals with fewer than 3 open tasks across all active projects
    active_goals = db.query(Goal).filter(Goal.status == "active").all()
    active_projects = db.query(Project).filter(Project.status == "active").all()
    projects_by_goal: dict[str, list] = {}
    for p in active_projects:
        projects_by_goal.setdefault(p.goal_id, []).append(p)

    open_tasks = db.query(Task).filter(
        Task.status.in_(["backlog", "active", "in_progress"])
    ).all()
    tasks_by_project: dict[str, list] = {}
    for t in open_tasks:
        tasks_by_project.setdefault(t.project_id, []).append(t)

    for goal in active_goals:
        goal_projects = projects_by_goal.get(goal.id, [])
        count = sum(len(tasks_by_project.get(p.id, [])) for p in goal_projects)
        if count < 3:
            alerts.append({
                "type": "thin_goal",
                "severity": "medium",
                "goal_id": str(goal.id),
                "message": f"'{goal.title}' is running low on tasks — add more to keep it moving.",
            })

    # Deferred task alerts: surface tasks that have been deferred
    deferred_tasks = db.query(Task).filter(Task.status == "deferred").all()
    for task in deferred_tasks:
        alerts.append({
            "type": "deferred_task",
            "severity": "medium",
            "task_id": str(task.id),
            "message": f"'{task.title}' has been deferred — reschedule or drop it?",
        })

    # Stale contact alerts
    try:
        from backend.models.person import Person as PersonModel
        from backend.models.commitment import Commitment as CommitmentModel
        from datetime import timedelta
        stale_threshold = now.date() - timedelta(days=30)
        stale = db.query(PersonModel).filter(
            PersonModel.is_active == True,
            (PersonModel.last_contact_date < stale_threshold) | (PersonModel.last_contact_date == None),
        ).all()
        for p in stale:
            alerts.append({
                "type": "stale_contact",
                "severity": "medium",
                "person_id": p.id,
                "message": f"Haven't been in touch with {p.name} in a while.",
            })

        # Overdue commitments
        overdue = db.query(CommitmentModel).filter(
            CommitmentModel.status == "open",
            CommitmentModel.due_date < now.date(),
        ).all()
        for c in overdue:
            alerts.append({
                "type": "overdue_commitment",
                "severity": "high",
                "commitment_id": c.id,
                "message": f"Overdue commitment to {c.person.name}: \"{c.description}\"",
            })
    except Exception:
        pass  # People tables may not exist yet

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
