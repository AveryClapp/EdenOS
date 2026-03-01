import math
from datetime import datetime

# --- Tunable constants (all decay parameters live here, never inline) ---
K_STEEPNESS: float = 2.5   # Controls how steeply urgency compounds near deadline
MIN_URGENCY: float = 0.01  # Floor — no task ever has zero urgency


def compute_urgency(
    base_priority: float,
    deadline: datetime | None,
    created_at: datetime,
    now: datetime | None = None,
) -> float:
    """
    Compute urgency using temporal decay:

        urgency(t) = base_priority * e^(K_STEEPNESS * (1 - days_remaining / total_days))

    - At creation (days_remaining == total_days): urgency == base_priority
    - At deadline (days_remaining == 0): urgency == base_priority * e^K_STEEPNESS
    - Past deadline or no total window: clamps to max urgency
    - No deadline: returns base_priority unchanged
    """
    if now is None:
        now = datetime.utcnow()

    if deadline is None:
        return base_priority

    total_days = (deadline - created_at).total_seconds() / 86400.0
    days_remaining = (deadline - now).total_seconds() / 86400.0

    if total_days <= 0 or days_remaining <= 0:
        # Already at or past deadline — max urgency
        return base_priority * math.exp(K_STEEPNESS)

    ratio = days_remaining / total_days
    urgency = base_priority * math.exp(K_STEEPNESS * (1.0 - ratio))
    return max(urgency, MIN_URGENCY)
