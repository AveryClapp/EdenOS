from datetime import datetime
from enum import Enum


class DayPhase(str, Enum):
    MORNING = "morning"      # before noon
    AFTERNOON = "afternoon"  # noon–17:00
    EVENING = "evening"      # 17:00–21:00
    NIGHT = "night"          # after 21:00


def get_temporal_context(
    now: datetime,
    last_session: datetime | None = None,
) -> dict:
    """
    Returns temporal context for the AI — what time it is, what phase of
    the day, and how long since the user last opened Eden.

    Eden uses this to adapt its opening behavior: morning brief vs afternoon
    check-in vs evening synthesis vs late-night debrief.
    """
    hour = now.hour
    if hour < 12:
        phase = DayPhase.MORNING
    elif hour < 17:
        phase = DayPhase.AFTERNOON
    elif hour < 21:
        phase = DayPhase.EVENING
    else:
        phase = DayPhase.NIGHT

    days_since_last = None
    if last_session is not None:
        delta = now - last_session
        days_since_last = delta.days

    return {
        "current_time": now.strftime("%H:%M"),
        "day_phase": phase,
        "day_of_week": now.strftime("%A"),
        "date": now.strftime("%Y-%m-%d"),
        "hours_left_in_day": max(0, 22 - hour),
        "days_since_last_session": days_since_last,
    }
