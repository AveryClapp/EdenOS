import uuid
from datetime import datetime, date, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from typing import Literal

from backend.db import get_db
from backend.models.person import Person
from backend.models.commitment import Commitment

router = APIRouter(prefix="/api/people", tags=["people"])

VALID_RELATIONSHIP_TYPES = {"friend", "colleague", "mentor", "family", "acquaintance"}


# ─── Schemas ──────────────────────────────────────────────────────────────────

class CommitmentOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    person_id: str
    description: str
    due_date: date | None
    status: str
    created_at: datetime


class PersonOut(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    name: str
    relationship_type: str
    context: str | None
    last_contact_date: date | None
    notes: str | None
    is_active: bool
    created_at: datetime
    commitments: list[CommitmentOut] = []


class PersonCreate(BaseModel):
    name: str
    relationship_type: Literal["friend", "colleague", "mentor", "family", "acquaintance"]
    context: str | None = None
    last_contact_date: date | None = None
    notes: str | None = None


class PersonUpdate(BaseModel):
    name: str | None = None
    relationship_type: Literal["friend", "colleague", "mentor", "family", "acquaintance"] | None = None
    context: str | None = None
    last_contact_date: date | None = None
    notes: str | None = None
    is_active: bool | None = None


class CommitmentCreate(BaseModel):
    description: str
    due_date: date | None = None


class CommitmentUpdate(BaseModel):
    description: str | None = None
    due_date: date | None = None
    status: Literal["open", "done", "dropped"] | None = None


# ─── People CRUD ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[PersonOut])
def list_people(
    stale_days: int | None = Query(default=None),
    db: Session = Depends(get_db),
):
    q = db.query(Person).filter(Person.is_active == True)
    if stale_days is not None:
        threshold = date.today() - timedelta(days=stale_days)
        q = q.filter(
            (Person.last_contact_date < threshold) | (Person.last_contact_date == None)
        )
    return q.order_by(Person.name).all()


@router.post("", response_model=PersonOut, status_code=201)
def create_person(body: PersonCreate, db: Session = Depends(get_db)):
    person = Person(
        id=str(uuid.uuid4()),
        name=body.name,
        relationship_type=body.relationship_type,
        context=body.context,
        last_contact_date=body.last_contact_date,
        notes=body.notes,
        created_at=datetime.utcnow(),
    )
    db.add(person)
    db.commit()
    db.refresh(person)
    return person


@router.get("/{person_id}", response_model=PersonOut)
def get_person(person_id: str, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    return person


@router.patch("/{person_id}", response_model=PersonOut)
def update_person(person_id: str, body: PersonUpdate, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(person, field, value)
    db.commit()
    db.refresh(person)
    return person


@router.delete("/{person_id}", status_code=204)
def delete_person(person_id: str, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    db.delete(person)
    db.commit()


@router.post("/{person_id}/contact", response_model=PersonOut)
def log_contact(person_id: str, db: Session = Depends(get_db)):
    """Mark today as the last contact date."""
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    person.last_contact_date = date.today()
    db.commit()
    db.refresh(person)
    return person


# ─── Commitments ──────────────────────────────────────────────────────────────

@router.post("/{person_id}/commitments", response_model=CommitmentOut, status_code=201)
def create_commitment(person_id: str, body: CommitmentCreate, db: Session = Depends(get_db)):
    person = db.get(Person, person_id)
    if not person:
        raise HTTPException(status_code=404, detail="Person not found")
    commitment = Commitment(
        id=str(uuid.uuid4()),
        person_id=person_id,
        description=body.description,
        due_date=body.due_date,
        created_at=datetime.utcnow(),
    )
    db.add(commitment)
    db.commit()
    db.refresh(commitment)
    return commitment


@router.patch("/commitments/{commitment_id}", response_model=CommitmentOut)
def update_commitment(commitment_id: str, body: CommitmentUpdate, db: Session = Depends(get_db)):
    commitment = db.get(Commitment, commitment_id)
    if not commitment:
        raise HTTPException(status_code=404, detail="Commitment not found")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(commitment, field, value)
    db.commit()
    db.refresh(commitment)
    return commitment


@router.delete("/commitments/{commitment_id}", status_code=204)
def delete_commitment(commitment_id: str, db: Session = Depends(get_db)):
    commitment = db.get(Commitment, commitment_id)
    if not commitment:
        raise HTTPException(status_code=404, detail="Commitment not found")
    db.delete(commitment)
    db.commit()
