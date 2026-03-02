import uuid
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.energy_profile import EnergyProfile
from backend.api.schemas import EnergyProfileBulkSet, EnergyProfileResponse

router = APIRouter(prefix="/api/energy-profile", tags=["energy-profile"])


@router.get("", response_model=list[EnergyProfileResponse])
def get_energy_profile(db: Session = Depends(get_db)):
    return db.query(EnergyProfile).all()


@router.put("", response_model=list[EnergyProfileResponse])
def set_energy_profile(body: EnergyProfileBulkSet, db: Session = Depends(get_db)):
    db.query(EnergyProfile).delete()
    entries = [
        EnergyProfile(
            id=str(uuid.uuid4()),
            hour_of_day=e.hour_of_day,
            day_of_week=e.day_of_week,
            energy_level=e.energy_level,
            is_post_hard_workout=e.is_post_hard_workout,
            notes=e.notes,
        )
        for e in body.entries
    ]
    db.add_all(entries)
    db.commit()
    for e in entries:
        db.refresh(e)
    return entries
