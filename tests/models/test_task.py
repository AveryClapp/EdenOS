import uuid
from datetime import date
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task


def _setup(db):
    goal = Goal(
        id=str(uuid.uuid4()), title="G", tier="long", weight=1.0,
        target_date=date(2027, 1, 1), status="active"
    )
    project = Project(
        id=str(uuid.uuid4()), title="P", category="engineering",
        goal_id=goal.id, status="active"
    )
    db.add_all([goal, project])
    db.commit()
    return project


def test_create_task(db):
    project = _setup(db)
    task = Task(
        id=str(uuid.uuid4()),
        project_id=project.id,
        title="Write tests",
        cognitive_load=2,
        estimated_minutes=90,
        status="backlog",
        source="manual",
    )
    db.add(task)
    db.commit()
    db.refresh(task)

    assert task.id is not None
    assert task.actual_minutes is None
    assert task.deadline is None
    assert task.created_at is not None


def test_task_dependency(db):
    project = _setup(db)
    t1 = Task(
        id=str(uuid.uuid4()), project_id=project.id,
        title="First", cognitive_load=1, estimated_minutes=30,
        status="backlog", source="manual"
    )
    t2 = Task(
        id=str(uuid.uuid4()), project_id=project.id,
        title="Second", cognitive_load=1, estimated_minutes=30,
        status="backlog", source="manual"
    )
    db.add_all([t1, t2])
    db.commit()

    t2.dependencies.append(t1)
    db.commit()
    db.refresh(t2)

    assert len(t2.dependencies) == 1
    assert t2.dependencies[0].id == t1.id
