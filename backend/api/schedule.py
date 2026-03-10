import json
import uuid
from datetime import datetime, date, time, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.models.energy_profile import EnergyProfile
from backend.models.availability_window import AvailabilityWindow
from backend.models.learning_record import LearningRecord
from backend.scheduler.engine import SchedulerEngine
from backend.scheduler.priority import recompute_all_priorities
from backend.intelligence.client import EdenClient
from backend.intelligence.explainer import generate_schedule_explanation
from backend.intelligence.goal_inference import check_goal_coverage
from backend.intelligence.rl_collector import record_episode, compute_rewards
from backend.models.plan_explanation import PlanExplanation
from backend.api.schemas import ScheduleOverride, ScheduleRunResponse, PlanDayRequest, PlanDayResponse

router = APIRouter(prefix="/api/schedule", tags=["schedule"])
_engine = SchedulerEngine()
_goal_proposals_cache: list[dict] = []


def _serialize_block(b):
    return {
        "id": b.id,
        "task_id": b.task_id,
        "calendar_event_id": getattr(b, "calendar_event_id", None),
        "date": str(b.date),
        "start_time": str(b.start_time),
        "end_time": str(b.end_time),
        "auto_generated": b.auto_generated,
        "overridden_by_user": b.overridden_by_user,
        "is_draft": getattr(b, "is_draft", False),
        "label": getattr(b, "label", None),
    }


@router.get("")
def get_schedule(
    start: date | None = Query(default=None),
    db: Session = Depends(get_db),
):
    start_date = start or date.today()
    end_date = start_date + timedelta(days=7)
    today = date.today()

    blocks = db.query(ScheduleBlock).filter(
        ScheduleBlock.date >= start_date,
        ScheduleBlock.date < end_date,
        ScheduleBlock.is_draft == False,
    ).all()

    return {
        "today": [_serialize_block(b) for b in blocks if b.date == today],
        "week": [_serialize_block(b) for b in blocks],
    }


def _recovery_multiplier(recovery_score: int) -> float:
    if recovery_score < 34:
        return 0.6   # red — significant reduction
    if recovery_score < 67:
        return 0.85  # yellow — moderate reduction
    return 1.0       # green — full energy


def _run_scheduler_job(db: Session) -> ScheduleRunResponse:
    """Core scheduler logic — callable from both the route and the background loop."""
    now = datetime.utcnow()
    start_date = date.today()

    tasks = db.query(Task).filter(
        Task.status.in_(["active", "backlog", "in_progress"])
    ).all()

    fixed_blocks = db.query(ScheduleBlock).filter(
        (ScheduleBlock.task_id.is_(None)) | (ScheduleBlock.overridden_by_user == True)
    ).all()

    energy_profiles = db.query(EnergyProfile).all()
    availability_windows = db.query(AvailabilityWindow).all()

    # Build per-cognitive-load correction factors from learning history.
    # Only applied when >= 3 samples exist for a given load level.
    correction_factors: dict[int, float] = {}
    records = db.query(LearningRecord).all()
    by_load: dict[int, list[float]] = {1: [], 2: [], 3: []}
    for r in records:
        if r.task and r.task.cognitive_load in by_load:
            by_load[r.task.cognitive_load].append(r.actual_minutes / r.estimated_minutes)
    for load, ratios in by_load.items():
        if len(ratios) >= 3:
            correction_factors[load] = sum(ratios) / len(ratios)

    from backend.models.whoop_daily import WhoopDaily
    from datetime import date as _date

    # Determine recovery multiplier from today's Whoop data
    today_whoop = db.query(WhoopDaily).filter(WhoopDaily.date == _date.today()).first()
    recovery_mult = 1.0
    if today_whoop and today_whoop.recovery_score is not None:
        recovery_mult = _recovery_multiplier(today_whoop.recovery_score)

    results = _engine.run(
        tasks=tasks,
        fixed_blocks=fixed_blocks,
        energy_profiles=energy_profiles,
        availability_windows=availability_windows,
        now=now,
        start_date=start_date,
        correction_factors=correction_factors,
        recovery_multiplier=recovery_mult,
    )

    deleted = db.query(ScheduleBlock).filter(
        ScheduleBlock.auto_generated == True,
        ScheduleBlock.overridden_by_user == False,
    ).delete(synchronize_session=False)
    db.flush()

    for result in results:
        block = ScheduleBlock(
            id=str(uuid.uuid4()),
            task_id=result.task_id,
            date=result.date,
            start_time=result.start_time,
            end_time=result.end_time,
            auto_generated=True,
            overridden_by_user=False,
        )
        db.add(block)

    db.commit()

    # Generate schedule explanation as background-style work (best-effort)
    try:
        today_blocks = [b for b in results if b.date == start_date]
        task_ids = [b.task_id for b in today_blocks if b.task_id]
        task_objs = {t.id: {"title": t.title, "cognitive_load": t.cognitive_load, "urgency": None}
                     for t in tasks if t.id in task_ids}
        blocks_for_explain = [
            {"task_id": b.task_id, "start_time": str(b.start_time),
             "end_time": str(b.end_time), "label": None}
            for b in today_blocks
        ]
        explanation = generate_schedule_explanation(blocks_for_explain, task_objs)
        existing = db.query(PlanExplanation).filter(PlanExplanation.date == start_date).first()
        if existing:
            existing.summary = explanation["summary"]
            existing.full_reasoning = json.dumps(explanation["block_reasoning"])
        else:
            db.add(PlanExplanation(
                id=str(uuid.uuid4()),
                date=start_date,
                summary=explanation["summary"],
                full_reasoning=json.dumps(explanation["block_reasoning"]),
                created_at=datetime.utcnow(),
            ))
        db.commit()
    except Exception:
        pass  # Explanation is best-effort — never fail the scheduler

    recompute_all_priorities(db, now=now)

    # Goal coverage check — propose tasks for thin goals (best-effort)
    try:
        _goal_proposals_cache.clear()
        proposals = check_goal_coverage(db)
        _goal_proposals_cache.extend(proposals)
    except Exception:
        pass

    # RL episode recording (best-effort)
    try:
        from backend.scheduler.decay import compute_urgency
        now = datetime.utcnow()
        rl_state = {
            "tasks": [
                {
                    "id": t.id,
                    "cognitive_load": t.cognitive_load,
                    "urgency": compute_urgency(1.0, t.deadline, t.created_at, now=now),
                    "estimated_minutes": t.estimated_minutes,
                }
                for t in tasks
            ],
            "day_of_week": start_date.weekday(),
        }
        rl_action = [
            {
                "task_id": r.task_id,
                "date": str(r.date),
                "start_time": str(r.start_time),
                "end_time": str(r.end_time),
            }
            for r in results
        ]
        record_episode(rl_action, rl_state, db)
    except Exception:
        pass

    # Energy profile update from learning records (best-effort)
    try:
        from backend.intelligence.energy_updater import update_energy_from_learning
        update_energy_from_learning(db)
    except Exception:
        pass

    return ScheduleRunResponse(blocks_cleared=deleted, blocks_created=len(results))


@router.post("/run", response_model=ScheduleRunResponse)
def run_scheduler(db: Session = Depends(get_db)):
    return _run_scheduler_job(db)


@router.get("/goal-proposals")
def get_goal_proposals():
    """Return inferred task proposals for thin goals."""
    return {"proposals": _goal_proposals_cache}


@router.get("/explanation")
def get_explanation(date: date = Query(default=None), db: Session = Depends(get_db)):
    from datetime import date as date_type
    target = date or date_type.today()
    row = db.query(PlanExplanation).filter(PlanExplanation.date == target).first()
    if not row:
        return {"summary": "", "block_reasoning": {}}
    return {
        "summary": row.summary,
        "block_reasoning": json.loads(row.full_reasoning or "{}"),
    }


@router.post("/plan-day", response_model=PlanDayResponse)
def plan_day(body: PlanDayRequest, db: Session = Depends(get_db)):
    if not body.intent.strip():
        raise HTTPException(status_code=400, detail="intent is required")

    eden = EdenClient()
    plan = eden.plan_day(body.intent.strip(), db)

    created_projects = 0
    created_tasks = 0

    for action in plan.get("actions", []):
        action_type = action.get("type")

        if action_type == "use_existing_project":
            project = db.query(Project).filter(Project.id == action.get("project_id")).first()
            if not project:
                continue
            for t in action.get("tasks", []):
                db.add(Task(
                    id=str(uuid.uuid4()),
                    project_id=project.id,
                    title=t["title"],
                    description=t.get("description"),
                    cognitive_load=t.get("cognitive_load", 2),
                    estimated_minutes=t.get("estimated_minutes", 60),
                    source="manual",
                    status="active",
                    created_at=datetime.utcnow(),
                ))
                created_tasks += 1

        elif action_type == "create_project":
            goal_id = action.get("goal_id")
            if not goal_id:
                goal = db.query(Goal).filter(Goal.status == "active").first()
                if not goal:
                    goal = Goal(
                        id=str(uuid.uuid4()),
                        title="General",
                        tier="long",
                        weight=1.0,
                        target_date=(datetime.utcnow() + timedelta(days=365)).date(),
                        status="active",
                        created_at=datetime.utcnow(),
                    )
                    db.add(goal)
                    db.flush()
                goal_id = goal.id

            project = Project(
                id=str(uuid.uuid4()),
                title=action["title"],
                category=action.get("category", "personal"),
                goal_id=goal_id,
                priority_score=0.0,
                status="active",
                estimated_hours_remaining=float(action.get("estimated_hours", 10)),
            )
            db.add(project)
            db.flush()
            created_projects += 1

            for t in action.get("tasks", []):
                db.add(Task(
                    id=str(uuid.uuid4()),
                    project_id=project.id,
                    title=t["title"],
                    description=t.get("description"),
                    cognitive_load=t.get("cognitive_load", 2),
                    estimated_minutes=t.get("estimated_minutes", 60),
                    source="manual",
                    status="active",
                    created_at=datetime.utcnow(),
                ))
                created_tasks += 1

    db.commit()
    schedule_result = _run_scheduler_job(db)

    return PlanDayResponse(
        summary=plan.get("summary", "Plan created."),
        reasoning=plan.get("reasoning", ""),
        created_projects=created_projects,
        created_tasks=created_tasks,
        blocks_created=schedule_result.blocks_created,
    )


@router.post("/override", status_code=201)
def create_override(body: ScheduleOverride, db: Session = Depends(get_db)):
    start_parts = body.start_time.split(":")
    end_parts = body.end_time.split(":")

    block = ScheduleBlock(
        id=str(uuid.uuid4()),
        task_id=body.task_id,
        date=body.date,
        start_time=time(int(start_parts[0]), int(start_parts[1])),
        end_time=time(int(end_parts[0]), int(end_parts[1])),
        auto_generated=False,
        overridden_by_user=True,
        label=body.label,
    )
    db.add(block)
    db.commit()
    db.refresh(block)

    return _serialize_block(block)
