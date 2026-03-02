from datetime import datetime, timedelta
import uuid

from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.scheduler.priority import recompute_all_priorities


def _goal(db, weight: float = 1.0) -> Goal:
    g = Goal(
        id=str(uuid.uuid4()),
        title="Test Goal",
        tier="long",
        weight=weight,
        target_date=(datetime.utcnow() + timedelta(days=365)).date(),
        status="active",
        created_at=datetime.utcnow(),
    )
    db.add(g)
    db.commit()
    return g


def _project(db, goal_id: str, status: str = "active") -> Project:
    p = Project(
        id=str(uuid.uuid4()),
        title="Test Project",
        category="engineering",
        goal_id=goal_id,
        priority_score=0.0,
        status=status,
        estimated_hours_remaining=10.0,
    )
    db.add(p)
    db.commit()
    return p


def _task(db, project_id: str, status: str = "backlog", deadline_offset_days: int | None = None) -> Task:
    now = datetime.utcnow()
    deadline = (now + timedelta(days=deadline_offset_days)) if deadline_offset_days is not None else None
    t = Task(
        id=str(uuid.uuid4()),
        project_id=project_id,
        title="Test Task",
        status=status,
        cognitive_load=2,
        estimated_minutes=60,
        source="manual",
        created_at=now - timedelta(days=1),
        deadline=deadline,
    )
    db.add(t)
    db.commit()
    return t


def test_no_tasks_gives_low_priority(db):
    g = _goal(db, weight=1.0)
    p = _project(db, g.id)
    recompute_all_priorities(db)
    db.refresh(p)
    assert p.priority_score == round(1.0 * 0.1, 4)


def test_task_without_deadline_gives_base_priority(db):
    g = _goal(db, weight=1.0)
    p = _project(db, g.id)
    _task(db, p.id, status="backlog", deadline_offset_days=None)
    recompute_all_priorities(db)
    db.refresh(p)
    # urgency == 1.0 (no deadline), priority == goal_weight * 1.0
    assert p.priority_score == 1.0


def test_task_with_deadline_increases_priority(db):
    g = _goal(db, weight=1.0)
    p = _project(db, g.id)
    _task(db, p.id, status="backlog", deadline_offset_days=None)  # urgency = 1.0
    _task(db, p.id, status="backlog", deadline_offset_days=2)      # urgency > 1.0
    recompute_all_priorities(db)
    db.refresh(p)
    assert p.priority_score > 1.0


def test_higher_goal_weight_raises_priority(db):
    g_low = _goal(db, weight=0.5)
    g_high = _goal(db, weight=2.0)
    p_low = _project(db, g_low.id)
    p_high = _project(db, g_high.id)
    _task(db, p_low.id, status="backlog")
    _task(db, p_high.id, status="backlog")
    recompute_all_priorities(db)
    db.refresh(p_low)
    db.refresh(p_high)
    assert p_high.priority_score > p_low.priority_score


def test_done_project_not_updated(db):
    g = _goal(db, weight=1.0)
    p = _project(db, g.id, status="done")
    p.priority_score = 99.0
    db.commit()
    _task(db, p.id, status="backlog")
    recompute_all_priorities(db)
    db.refresh(p)
    assert p.priority_score == 99.0  # unchanged


def test_deferred_only_tasks_treated_as_no_open_tasks(db):
    g = _goal(db, weight=1.0)
    p = _project(db, g.id)
    _task(db, p.id, status="deferred")
    recompute_all_priorities(db)
    db.refresh(p)
    assert p.priority_score == round(1.0 * 0.1, 4)
