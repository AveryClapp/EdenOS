import uuid
from datetime import time
from backend.models.availability_window import AvailabilityWindow


def test_create_window_for_specific_day(db):
    w = AvailabilityWindow(
        id=str(uuid.uuid4()),
        day_of_week=0,          # Monday
        start_time=time(8, 0),
        end_time=time(18, 0),
        is_available=True,
    )
    db.add(w)
    db.commit()
    db.refresh(w)

    assert w.id is not None
    assert w.day_of_week == 0
    assert w.note is None


def test_create_window_for_all_days(db):
    """day_of_week=None means the window applies every day."""
    w = AvailabilityWindow(
        id=str(uuid.uuid4()),
        day_of_week=None,
        start_time=time(6, 0),
        end_time=time(22, 0),
        is_available=True,
        note="Default daily window",
    )
    db.add(w)
    db.commit()
    db.refresh(w)

    assert w.day_of_week is None
    assert w.note == "Default daily window"
