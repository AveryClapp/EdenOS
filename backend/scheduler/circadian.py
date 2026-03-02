# Energy level at each hour offset from wake time.
# Based on: Cortisol Awakening Response (CAR), Core Body Temperature (CBT) curve,
# and post-lunch dip research.
_WAKE_OFFSET_ENERGY: dict[int, int] = {
    0: 2,   # Just waking — adenosine clearing, cortisol rising
    1: 4,   # CAR peak
    2: 5,   # Deep work window begins
    3: 5,
    4: 5,   # Deep work window ends
    5: 4,   # Post-peak
    6: 3,   # Stabilizing
    7: 2,   # Post-lunch nadir — body temperature dip
    8: 2,
    9: 4,   # Secondary peak — CBT peak
    10: 4,
    11: 3,  # Declining
    12: 2,
    13: 1,  # Wind-down begins
}

_DEFAULT_ENERGY: int = 1  # Any offset > 13 or before wake


def build_energy_defaults(wake_hour: int) -> list[dict]:
    """
    Return a 7-day × 24-hour energy profile anchored to wake_hour.

    The same curve is applied to every day of the week.
    Each entry: {"day_of_week": 0-6, "hour_of_day": 0-23, "energy_level": 1-5}

    Curve logic: offset = (clock_hour - wake_hour) % 24
    Offsets 2-4 → energy 5 (deep work window)
    Offsets 7-8 → energy 2 (nadir)
    Offsets 9-10 → energy 4 (secondary peak)
    """
    entries = []
    for day in range(7):
        for hour in range(24):
            offset = (hour - wake_hour) % 24
            energy = _WAKE_OFFSET_ENERGY.get(offset, _DEFAULT_ENERGY)
            entries.append({
                "day_of_week": day,
                "hour_of_day": hour,
                "energy_level": energy,
            })
    return entries
