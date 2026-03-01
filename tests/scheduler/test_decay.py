import math
from datetime import datetime, timedelta
from backend.scheduler.decay import compute_urgency, K_STEEPNESS


def _dates(days_total, days_remaining):
    now = datetime(2026, 3, 1, 12, 0, 0)
    created_at = now - timedelta(days=days_total - days_remaining)
    deadline = now + timedelta(days=days_remaining)
    return created_at, deadline, now


def test_urgency_at_t0():
    """At creation (full time remaining), urgency == base_priority * e^0 == base_priority."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=10)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS * (1 - 10/10))
    assert abs(result - expected) < 1e-9


def test_urgency_at_t_half():
    """At midpoint, urgency = base * e^(k * 0.5)."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=5)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS * 0.5)
    assert abs(result - expected) < 1e-9


def test_urgency_at_t_ninety_percent():
    """At 90% through the window, urgency = base * e^(k * 0.9)."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=1)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS * 0.9)
    assert abs(result - expected) < 1e-9


def test_urgency_past_deadline():
    """Past deadline: urgency is capped at base * e^k."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=-2)
    result = compute_urgency(1.0, deadline, created_at, now)
    expected = 1.0 * math.exp(K_STEEPNESS)
    assert abs(result - expected) < 1e-9


def test_urgency_no_deadline():
    """No deadline: returns base_priority unchanged."""
    now = datetime(2026, 3, 1, 12, 0, 0)
    created_at = now - timedelta(days=5)
    result = compute_urgency(0.7, deadline=None, created_at=created_at, now=now)
    assert result == 0.7


def test_urgency_scales_with_base_priority():
    """Higher base_priority → proportionally higher urgency."""
    created_at, deadline, now = _dates(days_total=10, days_remaining=5)
    u1 = compute_urgency(1.0, deadline, created_at, now)
    u2 = compute_urgency(2.0, deadline, created_at, now)
    assert abs(u2 - 2 * u1) < 1e-9
