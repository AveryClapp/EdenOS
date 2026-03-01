import uuid
from datetime import date
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.learning_record import LearningRecord


def _setup(db):
    goal = Goal(id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
                target_date=date(2027, 1, 1), status="active")
    project = Project(id=str(uuid.uuid4()), title="P", category="engineering",
                      goal_id=goal.id, status="active")
    task = Task(id=str(uuid.uuid4()), project_id=project.id, title="T",
                cognitive_load=2, estimated_minutes=60, status="done", source="manual")
    db.add_all([goal, project, task])
    db.commit()
    return task


def test_create_learning_record(db):
    task = _setup(db)
    record = LearningRecord(
        id=str(uuid.uuid4()),
        task_id=task.id,
        estimated_minutes=60,
        actual_minutes=75,
        energy_level_at_start=4,
        completion_quality=4,
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    assert record.id is not None
    assert record.actual_minutes == 75
    assert record.recorded_at is not None


def test_learning_records_are_independent(db):
    """Multiple records per task — append-only, never update existing."""
    task = _setup(db)
    for actual in [50, 65, 70]:
        record = LearningRecord(
            id=str(uuid.uuid4()),
            task_id=task.id,
            estimated_minutes=60,
            actual_minutes=actual,
            energy_level_at_start=3,
            completion_quality=3,
        )
        db.add(record)
    db.commit()

    from backend.models.learning_record import LearningRecord as LR
    records = db.query(LR).filter(LR.task_id == task.id).all()
    assert len(records) == 3
