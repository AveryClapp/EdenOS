import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.user_profile import UserProfile
from backend.api.schemas import UserProfileUpdate, UserProfileResponse
from backend.scheduler.circadian import build_energy_defaults

router = APIRouter(prefix="/api/user-profile", tags=["user-profile"])

_DEFAULT_WAKE_HOUR = 7
_DEFAULT_CHRONOTYPE = "intermediate"


def _get_or_create_profile(db: Session) -> UserProfile:
    profile = db.query(UserProfile).first()
    if not profile:
        profile = UserProfile(
            id=str(uuid.uuid4()),
            wake_hour=_DEFAULT_WAKE_HOUR,
            chronotype=_DEFAULT_CHRONOTYPE,
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("", response_model=UserProfileResponse)
def get_user_profile(db: Session = Depends(get_db)):
    return _get_or_create_profile(db)


@router.put("", response_model=UserProfileResponse)
def update_user_profile(body: UserProfileUpdate, db: Session = Depends(get_db)):
    profile = _get_or_create_profile(db)
    profile.wake_hour = body.wake_hour
    profile.chronotype = body.chronotype
    profile.autonomy_level = body.autonomy_level
    profile.planning_time = body.planning_time
    profile.planning_auto_lock_minutes = body.planning_auto_lock_minutes
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/energy-defaults")
def get_energy_defaults(db: Session = Depends(get_db)):
    profile = _get_or_create_profile(db)
    return build_energy_defaults(profile.wake_hour)
