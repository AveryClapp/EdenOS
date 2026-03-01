import uuid
from datetime import date, time
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.schedule_block import ScheduleBlock


def _setup(db):
    goal = Goal(id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
                target_date=date(2027, 1, 1), status="active")
    project = Project(id=str(uuid.uuid4()), title="P", category="engineering",
                      goal_id=goal.id, status="active")
    task = Task(id=str(uuid.uuid4()), project_id=project.id, title="T",
                cognitive_load=2, estimated_minutes=60, status="backlog", source="manual")
    db.add_all([goal, project, task])
    db.commit()
    return task


def test_create_schedule_block_with_task(db):
    task = _setup(db)
    block = ScheduleBlock(
        id=str(uuid.uuid4()),
        task_id=task.id,
        date=date(2026, 3, 2),
        start_time=time(9, 0),
        end_time=time(10, 0),
        auto_generated=True,
        overridden_by_user=False,
    )
    db.add(block)
    db.commit()
    db.refresh(block)

    assert block.id is not None
    assert block.overridden_by_user is False
    assert block.calendar_event_id is None


def test_create_fixed_external_block(db):
    """A block with no task (external calendar event)."""
    block = ScheduleBlock(
        id=str(uuid.uuid4()),
        task_id=None,
        calendar_event_id="gcal-event-abc123",
        date=date(2026, 3, 2),
        start_time=time(14, 0),
        end_time=time(15, 0),
        auto_generated=False,
        overridden_by_user=False,
    )
    db.add(block)
    db.commit()
    db.refresh(block)

    assert block.task_id is None
    assert block.calendar_event_id == "gcal-event-abc123"
