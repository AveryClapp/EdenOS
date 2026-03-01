import uuid
from backend.models.energy_profile import EnergyProfile


def test_create_energy_profile(db):
    ep = EnergyProfile(
        id=str(uuid.uuid4()),
        hour_of_day=9,
        day_of_week=0,  # Monday
        energy_level=5,
        is_post_hard_workout=False,
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)

    assert ep.id is not None
    assert ep.energy_level == 5
    assert ep.notes is None


def test_post_workout_flag(db):
    ep = EnergyProfile(
        id=str(uuid.uuid4()),
        hour_of_day=7,
        day_of_week=2,
        energy_level=2,
        is_post_hard_workout=True,
        notes="Ran 10k this morning",
    )
    db.add(ep)
    db.commit()
    db.refresh(ep)

    assert ep.is_post_hard_workout is True
    assert ep.notes == "Ran 10k this morning"
