import uuid
from datetime import date, datetime, timedelta, time
from backend.intelligence.context import build_context_snapshot
from backend.models.goal import Goal
from backend.models.project import Project
from backend.models.task import Task
from backend.models.energy_profile import EnergyProfile
from backend.models.schedule_block import ScheduleBlock
from backend.models.learning_record import LearningRecord


def _make_goal(db):
    g = Goal(
        id=str(uuid.uuid4()), title="Test Goal", tier="long",
        weight=0.9, target_date=date(2027, 1, 1), status="active",
    )
    db.add(g)
    db.commit()
    return g


def _make_project(db, goal):
    p = Project(
        id=str(uuid.uuid4()), title="Test Project", category="engineering",
        goal_id=goal.id, status="active",
    )
    db.add(p)
    db.commit()
    return p


def _make_task(db, project, status="backlog", deadline=None):
    t = Task(
        id=str(uuid.uuid4()), title="Test Task", project_id=project.id,
        cognitive_load=2, estimated_minutes=60,
        status=status, source="manual",
        deadline=deadline,
    )
    db.add(t)
    db.commit()
    return t


def test_snapshot_has_all_top_level_keys(db):
    snap = build_context_snapshot(db)
    for key in ("goals", "projects", "tasks", "schedule", "energy_profile", "learning_summary", "alerts"):
        assert key in snap, f"Missing key: {key}"


def test_snapshot_tasks_has_all_categories(db):
    snap = build_context_snapshot(db)
    for cat in ("due_soon", "active", "backlog", "deferred"):
        assert cat in snap["tasks"], f"Missing task category: {cat}"


def test_snapshot_schedule_has_today_and_week(db):
    snap = build_context_snapshot(db)
    assert "today" in snap["schedule"]
    assert "week" in snap["schedule"]


def test_active_goals_included(db):
    goal = _make_goal(db)
    snap = build_context_snapshot(db)
    ids = [g["id"] for g in snap["goals"]]
    assert goal.id in ids


def test_done_goals_excluded(db):
    goal = Goal(
        id=str(uuid.uuid4()), title="Done Goal", tier="long",
        weight=0.5, target_date=date(2025, 1, 1), status="done",
    )
    db.add(goal)
    db.commit()
    snap = build_context_snapshot(db)
    ids = [g["id"] for g in snap["goals"]]
    assert goal.id not in ids


def test_goal_serialization_fields(db):
    goal = _make_goal(db)
    snap = build_context_snapshot(db)
    g = next(g for g in snap["goals"] if g["id"] == goal.id)
    for field in ("id", "title", "tier", "weight", "target_date", "status"):
        assert field in g


def test_in_progress_task_goes_to_active(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="in_progress")
    snap = build_context_snapshot(db)
    active_ids = [t["id"] for t in snap["tasks"]["active"]]
    assert task.id in active_ids


def test_deferred_task_goes_to_deferred(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="deferred")
    snap = build_context_snapshot(db)
    deferred_ids = [t["id"] for t in snap["tasks"]["deferred"]]
    assert task.id in deferred_ids


def test_task_due_soon_within_72h(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now + timedelta(hours=48)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    due_soon_ids = [t["id"] for t in snap["tasks"]["due_soon"]]
    assert task.id in due_soon_ids


def test_task_serialization_includes_urgency(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now + timedelta(days=5)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    backlog_task = next(t for t in snap["tasks"]["backlog"] if t["id"] == task.id)
    assert "urgency_score" in backlog_task
    assert backlog_task["urgency_score"] > 0


def test_learning_summary_with_no_records(db):
    snap = build_context_snapshot(db)
    ls = snap["learning_summary"]
    assert ls["total_records"] == 0
    assert ls["avg_duration_ratio"] == 1.0


def test_learning_summary_with_records(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="done")
    record = LearningRecord(
        id=str(uuid.uuid4()), task_id=task.id,
        estimated_minutes=60, actual_minutes=90,
        energy_level_at_start=3, completion_quality=4,
    )
    db.add(record)
    db.commit()
    snap = build_context_snapshot(db)
    ls = snap["learning_summary"]
    assert ls["total_records"] == 1
    assert abs(ls["avg_duration_ratio"] - 1.5) < 1e-6


def test_alert_generated_for_task_past_deadline(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now - timedelta(hours=2)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    alert_tasks = [a["task_id"] for a in snap["alerts"] if a.get("task_id")]
    assert task.id in alert_tasks


def test_alert_generated_for_task_due_within_24h(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    now = datetime(2026, 3, 2, 9, 0, 0)
    deadline = now + timedelta(hours=12)
    task = _make_task(db, project, status="backlog", deadline=deadline)
    snap = build_context_snapshot(db, now=now)
    alert_tasks = [a["task_id"] for a in snap["alerts"] if a.get("task_id")]
    assert task.id in alert_tasks


def test_thin_goal_alert_generated(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    _make_task(db, project, status="backlog")
    snap = build_context_snapshot(db)
    thin_goal_ids = [a["goal_id"] for a in snap["alerts"] if a.get("type") == "thin_goal"]
    assert goal.id in thin_goal_ids


def test_deferred_task_alert_generated(db):
    goal = _make_goal(db)
    project = _make_project(db, goal)
    task = _make_task(db, project, status="deferred")
    snap = build_context_snapshot(db)
    deferred_alert_task_ids = [a["task_id"] for a in snap["alerts"] if a.get("type") == "deferred_task"]
    assert task.id in deferred_alert_task_ids
