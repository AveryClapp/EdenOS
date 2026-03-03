import uuid
from collections import defaultdict
from statistics import mean
from sqlalchemy.orm import Session
from backend.models.learning_record import LearningRecord
from backend.models.energy_profile import EnergyProfile

MIN_SAMPLES = 3


def update_energy_from_learning(db: Session) -> int:
    """Update EnergyProfile rows based on observed energy levels from LearningRecords.

    Groups records by (hour_of_day, day_of_week), skips any bucket with fewer
    than MIN_SAMPLES entries, and upserts the rounded mean energy level into
    EnergyProfile. Returns the number of profile rows created or updated.
    """
    records = db.query(LearningRecord).all()
    if not records:
        return 0

    buckets: dict[tuple[int, int], list[int]] = defaultdict(list)
    for r in records:
        hour = r.recorded_at.hour
        day = r.recorded_at.weekday()
        buckets[(hour, day)].append(r.energy_level_at_start)

    updated = 0
    for (hour, day), values in buckets.items():
        if len(values) < MIN_SAMPLES:
            continue
        new_level = max(1, min(5, round(mean(values))))
        existing = db.query(EnergyProfile).filter(
            EnergyProfile.hour_of_day == hour,
            EnergyProfile.day_of_week == day,
        ).first()
        if existing:
            existing.energy_level = new_level
        else:
            db.add(EnergyProfile(
                id=str(uuid.uuid4()),
                hour_of_day=hour,
                day_of_week=day,
                energy_level=new_level,
                is_post_hard_workout=False,
            ))
        updated += 1

    db.commit()
    return updated
