import uuid
from datetime import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.models.availability_window import AvailabilityWindow
from backend.api.schemas import AvailabilityCreate, AvailabilityUpdate, AvailabilityResponse

router = APIRouter(prefix="/api/availability", tags=["availability"])


def _parse_time(s: str) -> time:
    h, m = s.split(":")[:2]
    return time(int(h), int(m))


@router.get("", response_model=list[AvailabilityResponse])
def list_availability(db: Session = Depends(get_db)):
    return db.query(AvailabilityWindow).all()


@router.post("", response_model=AvailabilityResponse, status_code=201)
def create_availability(body: AvailabilityCreate, db: Session = Depends(get_db)):
    window = AvailabilityWindow(
        id=str(uuid.uuid4()),
        day_of_week=body.day_of_week,
        start_time=_parse_time(body.start_time),
        end_time=_parse_time(body.end_time),
        is_available=body.is_available,
        note=body.note,
    )
    db.add(window)
    db.commit()
    db.refresh(window)
    return window


@router.patch("/{window_id}", response_model=AvailabilityResponse)
def update_availability(window_id: str, body: AvailabilityUpdate, db: Session = Depends(get_db)):
    window = db.query(AvailabilityWindow).filter(AvailabilityWindow.id == window_id).first()
    if not window:
        raise HTTPException(status_code=404, detail="Availability window not found")
    data = body.model_dump(exclude_none=True)
    if "start_time" in data:
        data["start_time"] = _parse_time(data["start_time"])
    if "end_time" in data:
        data["end_time"] = _parse_time(data["end_time"])
    for field, value in data.items():
        setattr(window, field, value)
    db.commit()
    db.refresh(window)
    return window


@router.delete("/{window_id}", status_code=204)
def delete_availability(window_id: str, db: Session = Depends(get_db)):
    window = db.query(AvailabilityWindow).filter(AvailabilityWindow.id == window_id).first()
    if not window:
        raise HTTPException(status_code=404, detail="Availability window not found")
    db.delete(window)
    db.commit()
