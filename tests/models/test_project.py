import uuid
from datetime import date
from backend.models.goal import Goal
from backend.models.project import Project


def _make_goal(db):
    g = Goal(
        id=str(uuid.uuid4()),
        title="Root goal",
        tier="long",
        weight=1.0,
        target_date=date(2027, 1, 1),
        status="active",
    )
    db.add(g)
    db.commit()
    return g


def test_create_project(db):
    goal = _make_goal(db)
    project = Project(
        id=str(uuid.uuid4()),
        title="Eden backend",
        category="engineering",
        motivation="Ship the MVP",
        goal_id=goal.id,
        status="active",
        estimated_hours_remaining=80.0,
    )
    db.add(project)
    db.commit()
    db.refresh(project)

    assert project.id is not None
    assert project.priority_score == 0.0
    assert project.goal_id == goal.id
    assert project.github_repo is None


def test_project_category_enum(db):
    goal = _make_goal(db)
    for cat in ["research", "engineering", "academic", "athletic", "career", "personal"]:
        p = Project(
            id=str(uuid.uuid4()),
            title=f"Project {cat}",
            category=cat,
            motivation="test",
            goal_id=goal.id,
            status="active",
        )
        db.add(p)
    db.commit()
