from dataclasses import dataclass
from datetime import date, time, datetime, timedelta

# --- Constants ---
SLOT_MINUTES: int = 30
HORIZON_DAYS: int = 7
SLOTS_PER_DAY: int = (24 * 60) // SLOT_MINUTES  # 48
DEFAULT_START_HOUR: int = 6   # 6am
DEFAULT_END_HOUR: int = 22    # 10pm


@dataclass(frozen=True)
class TimeSlot:
    date: date
    slot_index: int  # 0 = 00:00, 1 = 00:30, ..., 47 = 23:30

    @property
    def start_time(self) -> time:
        total_minutes = self.slot_index * SLOT_MINUTES
        return time(total_minutes // 60, total_minutes % 60)

    @property
    def end_time(self) -> time:
        total_minutes = (self.slot_index + 1) * SLOT_MINUTES
        h, m = divmod(total_minutes, 60)
        return time(h % 24, m)

    @property
    def absolute_index(self) -> int:
        """Monotonically increasing integer across all days (used for ordering)."""
        epoch = date(2026, 1, 1)
        day_offset = (self.date - epoch).days
        return day_offset * SLOTS_PER_DAY + self.slot_index

    @property
    def hour(self) -> int:
        return (self.slot_index * SLOT_MINUTES) // 60

    @property
    def day_of_week(self) -> int:
        """0 = Monday."""
        return self.date.weekday()


def build_slot_grid(start_date: date, availability_windows: list) -> list[TimeSlot]:
    """
    Return all available TimeSlots for a HORIZON_DAYS window starting at start_date.

    Uses availability_windows to determine which hours are open on each day.
    If availability_windows is empty, defaults to DEFAULT_START_HOUR-DEFAULT_END_HOUR every day.
    """
    slots = []
    for day_offset in range(HORIZON_DAYS):
        current_date = start_date + timedelta(days=day_offset)
        dow = current_date.weekday()  # 0=Monday

        # Find applicable windows for this day
        applicable = [
            w for w in availability_windows
            if w.is_available and (w.day_of_week is None or w.day_of_week == dow)
        ]

        if applicable:
            for window in applicable:
                start_slot = _time_to_slot_index(window.start_time)
                end_slot = _time_to_slot_index(window.end_time)
                for idx in range(start_slot, end_slot):
                    slots.append(TimeSlot(date=current_date, slot_index=idx))
        else:
            # Default window
            for idx in range(
                DEFAULT_START_HOUR * (60 // SLOT_MINUTES),
                DEFAULT_END_HOUR * (60 // SLOT_MINUTES),
            ):
                slots.append(TimeSlot(date=current_date, slot_index=idx))

    return slots


def is_slot_blocked(slot: TimeSlot, fixed_blocks: list) -> bool:
    """
    Returns True if any fixed block overlaps this slot.

    External events (task_id=None) always block.
    User-overridden blocks (overridden_by_user=True) block even if they have a task_id.
    Auto-generated scheduler blocks without override do NOT block (they can be rescheduled).
    """
    for block in fixed_blocks:
        if block.date != slot.date:
            continue
        # Only block if external event OR user-overridden
        if block.task_id is not None and not block.overridden_by_user:
            continue
        if block.start_time <= slot.start_time < block.end_time:
            return True
    return False


def is_recovery_slot(slot: TimeSlot, energy_profiles: list) -> bool:
    """Returns True if the matching EnergyProfile marks this slot as post-hard-workout."""
    for profile in energy_profiles:
        if profile.hour_of_day == slot.hour and profile.day_of_week == slot.day_of_week:
            return profile.is_post_hard_workout
    return False


def get_slot_energy(slot: TimeSlot, energy_profiles: list) -> int:
    """
    Returns energy level (1-5) for this slot.
    Defaults to 3 (moderate) if no matching profile exists.
    """
    for profile in energy_profiles:
        if profile.hour_of_day == slot.hour and profile.day_of_week == slot.day_of_week:
            return profile.energy_level
    return 3


def _time_to_slot_index(t: time) -> int:
    return (t.hour * 60 + t.minute) // SLOT_MINUTES
