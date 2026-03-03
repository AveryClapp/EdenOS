import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.user_profile import UserProfile
from backend.models.energy_profile import EnergyProfile
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


def _reseed_energy_profile(db: Session, wake_hour: int) -> None:
    """Replace all EnergyProfile rows with the circadian defaults for wake_hour."""
    db.query(EnergyProfile).delete()
    for entry in build_energy_defaults(wake_hour):
        db.add(EnergyProfile(
            id=str(uuid.uuid4()),
            hour_of_day=entry["hour_of_day"],
            day_of_week=entry["day_of_week"],
            energy_level=entry["energy_level"],
            is_post_hard_workout=False,
        ))


@router.put("", response_model=UserProfileResponse)
def update_user_profile(body: UserProfileUpdate, db: Session = Depends(get_db)):
    profile = _get_or_create_profile(db)
    wake_hour_changed = profile.wake_hour != body.wake_hour
    profile.wake_hour = body.wake_hour
    profile.chronotype = body.chronotype
    profile.autonomy_level = body.autonomy_level
    profile.planning_time = body.planning_time
    profile.planning_auto_lock_minutes = body.planning_auto_lock_minutes
    if wake_hour_changed:
        _reseed_energy_profile(db, body.wake_hour)
    db.commit()
    db.refresh(profile)
    return profile


@router.get("/energy-defaults")
def get_energy_defaults(db: Session = Depends(get_db)):
    profile = _get_or_create_profile(db)
    return build_energy_defaults(profile.wake_hour)
