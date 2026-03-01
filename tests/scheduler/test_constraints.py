from datetime import date, time, datetime
from types import SimpleNamespace
from backend.scheduler.constraints import (
    TimeSlot,
    DEFAULT_START_HOUR,
    DEFAULT_END_HOUR,
    SLOT_MINUTES,
    build_slot_grid,
    is_slot_blocked,
    is_recovery_slot,
    get_slot_energy,
)


# --- TimeSlot ---

def test_timeslot_start_time():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)  # 16 * 30 = 480 min = 8:00am
    assert slot.start_time == time(8, 0)


def test_timeslot_end_time():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)
    assert slot.end_time == time(8, 30)


def test_timeslot_absolute_index_increases_across_days():
    day1_slot = TimeSlot(date=date(2026, 3, 2), slot_index=0)
    day2_slot = TimeSlot(date=date(2026, 3, 3), slot_index=0)
    assert day2_slot.absolute_index > day1_slot.absolute_index


# --- build_slot_grid ---

def test_build_slot_grid_default_window():
    """With no availability windows, defaults to DEFAULT_START_HOUR-DEFAULT_END_HOUR every day."""
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[])
    expected_count = 7 * (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * (60 // SLOT_MINUTES)
    assert len(slots) == expected_count


def test_build_slot_grid_respects_custom_window():
    """Custom 2-hour window produces 4 slots per day × 7 days."""
    window = SimpleNamespace(day_of_week=None, start_time=time(9, 0), end_time=time(11, 0), is_available=True)
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[window])
    assert len(slots) == 7 * 4  # 7 days x 4 slots (2h x 2 slots/h)


def test_build_slot_grid_day_specific_window():
    """day_of_week=0 (Monday) window applies to Monday only; other days get the default."""
    # 2026-03-02 is a Monday
    window = SimpleNamespace(day_of_week=0, start_time=time(9, 0), end_time=time(11, 0), is_available=True)
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[window])
    # Monday: 4 slots (9am-11am); other 6 days: default window
    expected = 4 + 6 * (DEFAULT_END_HOUR - DEFAULT_START_HOUR) * (60 // SLOT_MINUTES)
    assert len(slots) == expected


def test_build_slot_grid_spans_seven_days():
    slots = build_slot_grid(start_date=date(2026, 3, 2), availability_windows=[])
    dates = {s.date for s in slots}
    assert len(dates) == 7


# --- is_slot_blocked ---

def test_slot_is_blocked_by_external_block():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)  # 8:00-8:30
    block = SimpleNamespace(
        date=date(2026, 3, 2),
        start_time=time(8, 0),
        end_time=time(9, 0),
        task_id=None,
        overridden_by_user=False,
    )
    assert is_slot_blocked(slot, [block]) is True


def test_slot_not_blocked_when_no_overlap():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=20)  # 10:00-10:30
    block = SimpleNamespace(
        date=date(2026, 3, 2),
        start_time=time(8, 0),
        end_time=time(9, 0),
        task_id=None,
        overridden_by_user=False,
    )
    assert is_slot_blocked(slot, [block]) is False


def test_override_block_is_blocked():
    """overridden_by_user=True blocks the slot even with a task_id."""
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=16)
    block = SimpleNamespace(
        date=date(2026, 3, 2),
        start_time=time(8, 0),
        end_time=time(9, 0),
        task_id="some-task",
        overridden_by_user=True,
    )
    assert is_slot_blocked(slot, [block]) is True


# --- is_recovery_slot ---

def test_recovery_slot_detected():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=14)  # 7:00am, Monday (dow=0)
    profile = SimpleNamespace(hour_of_day=7, day_of_week=0, is_post_hard_workout=True, energy_level=2)
    assert is_recovery_slot(slot, [profile]) is True


def test_non_recovery_slot():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=18)  # 9:00am
    profile = SimpleNamespace(hour_of_day=9, day_of_week=0, is_post_hard_workout=False, energy_level=4)
    assert is_recovery_slot(slot, [profile]) is False


# --- get_slot_energy ---

def test_get_energy_returns_profile_value():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=18)  # 9:00am Monday
    profile = SimpleNamespace(hour_of_day=9, day_of_week=0, is_post_hard_workout=False, energy_level=5)
    assert get_slot_energy(slot, [profile]) == 5


def test_get_energy_defaults_to_3():
    slot = TimeSlot(date=date(2026, 3, 2), slot_index=18)
    assert get_slot_energy(slot, []) == 3  # No profile → default
