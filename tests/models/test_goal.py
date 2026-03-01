import uuid
from datetime import date, datetime
from backend.models.goal import Goal


def test_create_goal(db):
    goal = Goal(
        id=str(uuid.uuid4()),
        title="Publish ML paper",
        description="Submit to NeurIPS 2026",
        tier="long",
        weight=0.8,
        target_date=date(2026, 9, 1),
        status="active",
    )
    db.add(goal)
    db.commit()
    db.refresh(goal)

    assert goal.id is not None
    assert goal.title == "Publish ML paper"
    assert goal.tier == "long"
    assert goal.created_at is not None


def test_goal_parent_child(db):
    parent = Goal(
        id=str(uuid.uuid4()),
        title="Long-term career",
        tier="long",
        weight=1.0,
        target_date=date(2027, 1, 1),
        status="active",
    )
    db.add(parent)
    db.commit()

    child = Goal(
        id=str(uuid.uuid4()),
        title="Q1 promotion prep",
        tier="mid",
        parent_id=parent.id,
        weight=0.6,
        target_date=date(2026, 4, 1),
        status="active",
    )
    db.add(child)
    db.commit()
    db.refresh(child)

    assert child.parent_id == parent.id
