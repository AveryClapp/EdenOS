import uuid
from datetime import datetime, date, time, timedelta
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock
from backend.models.energy_profile import EnergyProfile
from backend.models.availability_window import AvailabilityWindow
from backend.models.learning_record import LearningRecord
from backend.scheduler.engine import SchedulerEngine
from backend.scheduler.priority import recompute_all_priorities
from backend.api.schemas import ScheduleOverride, ScheduleRunResponse

router = APIRouter(prefix="/api/schedule", tags=["schedule"])
_engine = SchedulerEngine()


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
    ).all()

    return {
        "today": [_serialize_block(b) for b in blocks if b.date == today],
        "week": [_serialize_block(b) for b in blocks],
    }


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

    results = _engine.run(
        tasks=tasks,
        fixed_blocks=fixed_blocks,
        energy_profiles=energy_profiles,
        availability_windows=availability_windows,
        now=now,
        start_date=start_date,
        correction_factors=correction_factors,
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
    recompute_all_priorities(db, now=now)
    return ScheduleRunResponse(blocks_cleared=deleted, blocks_created=len(results))


@router.post("/run", response_model=ScheduleRunResponse)
def run_scheduler(db: Session = Depends(get_db)):
    return _run_scheduler_job(db)


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
    )
    db.add(block)
    db.commit()
    db.refresh(block)

    return _serialize_block(block)
