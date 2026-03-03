from datetime import datetime, timedelta
from backend.db import Base
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import backend.models  # noqa — registers all models with Base

from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.learning_record import LearningRecord
from backend.models.energy_profile import EnergyProfile


def _make_db():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    return Session()


def _seed_prerequisites(db):
    """Seed a Goal, Project, and Task required as FK parents for LearningRecord."""
    g = Goal(
        id="g1",
        title="Test Goal",
        tier="long",
        weight=1.0,
        target_date=datetime(2027, 1, 1).date(),
        status="active",
        created_at=datetime.utcnow(),
    )
    p = Project(
        id="p1",
        title="Test Project",
        category="engineering",
        goal_id="g1",
        priority_score=0.0,
        status="active",
        estimated_hours_remaining=10.0,
    )
    t = Task(
        id="t1",
        project_id="p1",
        title="Test Task",
        cognitive_load=2,
        estimated_minutes=60,
        source="manual",
        status="done",
        created_at=datetime.utcnow(),
    )
    db.add_all([g, p, t])
    db.commit()


def _make_learning_record(record_id: str, hour: int, day_offset: int, energy: int) -> LearningRecord:
    """Build a LearningRecord with recorded_at set to the given hour on a day
    whose weekday() equals (Monday + day_offset % 7). day_offset=0 => Monday."""
    # Find a Monday in the past to anchor weekday arithmetic.
    # 2026-03-02 is a Monday.
    anchor_monday = datetime(2026, 3, 2, hour, 0, 0)
    recorded_at = anchor_monday + timedelta(days=day_offset)
    return LearningRecord(
        id=record_id,
        task_id="t1",
        estimated_minutes=60,
        actual_minutes=55,
        energy_level_at_start=energy,
        completion_quality=4,
        recorded_at=recorded_at,
    )


def test_updates_energy_profile_from_learning_records():
    """3 records at the same hour/day with energy=4 should create an EnergyProfile with level=4."""
    from backend.intelligence.energy_updater import update_energy_from_learning

    db = _make_db()
    _seed_prerequisites(db)

    # 3 records all at hour=9, day_of_week=0 (Monday), energy=4
    db.add_all([
        _make_learning_record("lr1", hour=9, day_offset=0, energy=4),
        _make_learning_record("lr2", hour=9, day_offset=0, energy=4),
        _make_learning_record("lr3", hour=9, day_offset=0, energy=4),
    ])
    db.commit()

    result = update_energy_from_learning(db)

    assert result == 1
    profile = db.query(EnergyProfile).filter(
        EnergyProfile.hour_of_day == 9,
        EnergyProfile.day_of_week == 0,
    ).first()
    assert profile is not None
    assert profile.energy_level == 4


def test_skips_buckets_with_fewer_than_3_samples():
    """Only 2 records at the same hour/day should result in no EnergyProfile row being created."""
    from backend.intelligence.energy_updater import update_energy_from_learning

    db = _make_db()
    _seed_prerequisites(db)

    # 2 records at hour=14, day_of_week=2 (Wednesday), energy=3
    db.add_all([
        _make_learning_record("lr1", hour=14, day_offset=2, energy=3),
        _make_learning_record("lr2", hour=14, day_offset=2, energy=3),
    ])
    db.commit()

    result = update_energy_from_learning(db)

    assert result == 0
    profile = db.query(EnergyProfile).filter(
        EnergyProfile.hour_of_day == 14,
        EnergyProfile.day_of_week == 2,
    ).first()
    assert profile is None


def test_creates_new_profile_entry_if_missing():
    """3 records for an hour/day with no existing EnergyProfile should create a new row."""
    from backend.intelligence.energy_updater import update_energy_from_learning

    db = _make_db()
    _seed_prerequisites(db)

    # Confirm no EnergyProfile exists at hour=8, day=1 (Tuesday) before the call
    assert db.query(EnergyProfile).filter(
        EnergyProfile.hour_of_day == 8,
        EnergyProfile.day_of_week == 1,
    ).first() is None

    # Seed 3 records at hour=8, day_offset=1 (Tuesday), energies 3/4/5 => mean=4
    db.add_all([
        _make_learning_record("lr1", hour=8, day_offset=1, energy=3),
        _make_learning_record("lr2", hour=8, day_offset=1, energy=4),
        _make_learning_record("lr3", hour=8, day_offset=1, energy=5),
    ])
    db.commit()

    result = update_energy_from_learning(db)

    assert result == 1
    new_profile = db.query(EnergyProfile).filter(
        EnergyProfile.hour_of_day == 8,
        EnergyProfile.day_of_week == 1,
    ).first()
    assert new_profile is not None
    assert new_profile.energy_level == 4  # round(mean([3,4,5])) = round(4.0) = 4
    assert new_profile.is_post_hard_workout is False
