import uuid
from datetime import datetime
from backend.models.user_memory import UserMemory
from backend.models.schedule_block import ScheduleBlock
from backend.models.user_profile import UserProfile


def test_user_memory_model(db):
    mem = UserMemory(
        id=str(uuid.uuid4()),
        category="preference",
        content="prefers not to schedule admin before 10am",
        confidence=0.9,
        source="chat",
    )
    db.add(mem)
    db.commit()
    fetched = db.get(UserMemory, mem.id)
    assert fetched.content == "prefers not to schedule admin before 10am"
    assert fetched.is_active is True


def test_schedule_block_has_is_draft(db):
    assert hasattr(ScheduleBlock, 'is_draft')


def test_user_profile_has_autonomy_fields(db):
    assert hasattr(UserProfile, 'autonomy_level')
    assert hasattr(UserProfile, 'planning_time')
    assert hasattr(UserProfile, 'planning_auto_lock_minutes')


def test_user_memory_defaults_active(db):
    mem = UserMemory(
        id=str(uuid.uuid4()),
        category="personal",
        content="training for Ironman through October",
        confidence=1.0,
        source="user",
    )
    db.add(mem)
    db.commit()
    assert db.get(UserMemory, mem.id).is_active is True
