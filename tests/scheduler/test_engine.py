import uuid
from datetime import date, time, datetime, timedelta
from types import SimpleNamespace
from backend.scheduler.engine import SchedulerEngine, ScheduleBlockResult


# --- Helpers ---

def make_task(
    cognitive_load=2,
    estimated_minutes=60,
    deadline=None,
    created_at=None,
    dependencies=None,
    status="active",
):
    now = datetime(2026, 3, 1, 12, 0, 0)
    return SimpleNamespace(
        id=str(uuid.uuid4()),
        cognitive_load=cognitive_load,
        estimated_minutes=estimated_minutes,
        deadline=deadline,
        created_at=created_at or (now - timedelta(days=5)),
        dependencies=dependencies or [],
        status=status,
    )


def make_block(d, start_h, end_h, task_id=None, overridden_by_user=False):
    return SimpleNamespace(
        date=d,
        start_time=time(start_h, 0),
        end_time=time(end_h, 0),
        task_id=task_id,
        overridden_by_user=overridden_by_user,
    )


START = date(2026, 3, 2)  # Monday
ENGINE = SchedulerEngine()


def test_single_task_gets_scheduled():
    task = make_task(estimated_minutes=30)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    assert results[0].task_id == task.id


def test_task_fills_correct_number_of_slots():
    """A 90-minute task requires 3 x 30-min slots."""
    task = make_task(estimated_minutes=90)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 3


def test_results_are_schedule_block_results():
    task = make_task(estimated_minutes=30)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert isinstance(results[0], ScheduleBlockResult)
    assert results[0].auto_generated is True
    assert results[0].overridden_by_user is False


def test_task_not_placed_in_blocked_slot():
    """External block 6am-10am on Monday → task goes elsewhere."""
    task = make_task(estimated_minutes=30)
    block = make_block(START, start_h=6, end_h=10)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[block],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    result = results[0]
    if result.date == START:
        assert result.start_time >= time(10, 0)


def test_overridden_block_is_never_displaced():
    """overridden_by_user=True slot must not be assigned to any task."""
    task = make_task(estimated_minutes=30)
    override_block = make_block(START, start_h=8, end_h=9, task_id="other-task", overridden_by_user=True)
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[override_block],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    result = results[0]
    if result.date == START:
        assert not (time(8, 0) <= result.start_time < time(9, 0))


def test_high_load_task_not_placed_in_recovery_slot():
    """cognitive_load=3 task must not go in a recovery slot."""
    task = make_task(cognitive_load=3, estimated_minutes=30)
    profiles = [
        SimpleNamespace(hour_of_day=h, day_of_week=d, is_post_hard_workout=(h < 10), energy_level=2 if h < 10 else 4)
        for h in range(6, 22) for d in range(7)
    ]
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=profiles,
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1
    if results[0].date == START:
        assert results[0].start_time >= time(10, 0)


def test_low_load_task_allowed_in_recovery_slot():
    """cognitive_load=1 task CAN be placed in a recovery slot."""
    task = make_task(cognitive_load=1, estimated_minutes=30)
    profiles = [
        SimpleNamespace(hour_of_day=6, day_of_week=0, is_post_hard_workout=True, energy_level=2)
    ]
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=profiles,
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    assert len(results) == 1  # scheduled somewhere — recovery slot is allowed for load=1


def test_task_not_scheduled_past_deadline():
    """Task with a Tuesday EOD deadline must not be scheduled after that."""
    now = datetime(2026, 3, 1, 12, 0, 0)
    deadline = datetime(2026, 3, 3, 23, 59, 59)  # Tuesday EOD
    task = make_task(estimated_minutes=30, deadline=deadline, created_at=now - timedelta(days=5))
    results = ENGINE.run(
        tasks=[task],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=now,
        start_date=START,
    )
    assert len(results) == 1
    result = results[0]
    assert datetime.combine(result.date, result.end_time) <= deadline


def test_dependency_ordering():
    """All of task_a's slots must end before any of task_b's slots start."""
    task_a = make_task(estimated_minutes=30)
    task_b = make_task(estimated_minutes=30, dependencies=[task_a])
    results = ENGINE.run(
        tasks=[task_a, task_b],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    a_results = [r for r in results if r.task_id == task_a.id]
    b_results = [r for r in results if r.task_id == task_b.id]
    assert a_results and b_results

    max_a_end = max(datetime.combine(r.date, r.end_time) for r in a_results)
    min_b_start = min(datetime.combine(r.date, r.start_time) for r in b_results)
    assert max_a_end <= min_b_start


def test_engine_is_deterministic():
    """Same input → same output on repeated runs."""
    tasks = [make_task(estimated_minutes=60) for _ in range(3)]
    kwargs = dict(
        tasks=tasks,
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        now=datetime(2026, 3, 1, 12, 0, 0),
        start_date=START,
    )
    run1 = ENGINE.run(**kwargs)
    run2 = ENGINE.run(**kwargs)

    assert len(run1) == len(run2)
    for r1, r2 in zip(
        sorted(run1, key=lambda r: (r.task_id, str(r.date), str(r.start_time))),
        sorted(run2, key=lambda r: (r.task_id, str(r.date), str(r.start_time))),
    ):
        assert r1.task_id == r2.task_id
        assert r1.date == r2.date
        assert r1.start_time == r2.start_time


def test_recovery_multiplier_reduces_energy_weight():
    """With low recovery, load=3 tasks should score lower and get worse slots."""
    # This is a smoke test — just verify the engine accepts recovery_multiplier
    # and runs without error.
    from backend.scheduler.engine import SchedulerEngine
    from datetime import datetime, date, time
    import uuid

    class _Task:
        id = str(uuid.uuid4())
        project_id = "p1"
        title = "Deep task"
        status = "active"
        cognitive_load = 3
        estimated_minutes = 60
        deadline = None
        created_at = datetime(2026, 1, 1)
        dependencies = []

    engine = SchedulerEngine()
    # Should not raise with recovery_multiplier parameter
    results = engine.run(
        tasks=[_Task()],
        fixed_blocks=[],
        energy_profiles=[],
        availability_windows=[],
        recovery_multiplier=0.6,
    )
    # Results may be empty or have blocks — just verify no crash
    assert isinstance(results, list)
