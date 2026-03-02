import uuid
from backend.models.user_profile import UserProfile


def test_user_profile_model(db):
    profile = UserProfile(id=str(uuid.uuid4()), wake_hour=7, chronotype="intermediate")
    db.add(profile)
    db.commit()
    fetched = db.get(UserProfile, profile.id)
    assert fetched.wake_hour == 7
    assert fetched.chronotype == "intermediate"
