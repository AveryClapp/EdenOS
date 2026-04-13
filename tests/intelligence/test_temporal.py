from datetime import datetime
from backend.intelligence.temporal import get_temporal_context, DayPhase


def test_morning_phase():
    now = datetime(2026, 4, 12, 8, 30)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.MORNING


def test_afternoon_phase():
    now = datetime(2026, 4, 12, 14, 0)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.AFTERNOON


def test_evening_phase():
    now = datetime(2026, 4, 12, 18, 0)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.EVENING


def test_night_phase():
    now = datetime(2026, 4, 12, 22, 0)
    ctx = get_temporal_context(now)
    assert ctx["day_phase"] == DayPhase.NIGHT


def test_hours_left_in_day():
    now = datetime(2026, 4, 12, 14, 0)
    ctx = get_temporal_context(now)
    assert ctx["hours_left_in_day"] == 8  # 22 - 14


def test_hours_left_clamped_at_zero():
    now = datetime(2026, 4, 12, 23, 0)
    ctx = get_temporal_context(now)
    assert ctx["hours_left_in_day"] == 0


def test_days_since_last_session_none():
    now = datetime(2026, 4, 12, 9, 0)
    ctx = get_temporal_context(now, last_session=None)
    assert ctx["days_since_last_session"] is None


def test_days_since_last_session_calculated():
    now = datetime(2026, 4, 12, 9, 0)
    last = datetime(2026, 4, 9, 9, 0)
    ctx = get_temporal_context(now, last_session=last)
    assert ctx["days_since_last_session"] == 3


def test_context_contains_required_keys():
    now = datetime(2026, 4, 12, 9, 0)
    ctx = get_temporal_context(now)
    for key in ["current_time", "day_phase", "day_of_week", "date", "hours_left_in_day", "days_since_last_session"]:
        assert key in ctx


def test_current_time_format():
    now = datetime(2026, 4, 12, 9, 5)
    ctx = get_temporal_context(now)
    assert ctx["current_time"] == "09:05"


def test_day_of_week():
    now = datetime(2026, 4, 12, 9, 0)  # Sunday
    ctx = get_temporal_context(now)
    assert ctx["day_of_week"] == "Sunday"
