import uuid
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from backend.db import get_db
from backend.models.user_memory import UserMemory
from backend.api.schemas import MemoryCreate, MemoryUpdate, MemoryResponse

router = APIRouter(prefix="/api/memory", tags=["memory"])

@router.get("", response_model=list[MemoryResponse])
def list_memory(db: Session = Depends(get_db)):
    return db.query(UserMemory).filter(UserMemory.is_active == True).all()

@router.post("", response_model=MemoryResponse)
def create_memory(body: MemoryCreate, db: Session = Depends(get_db)):
    mem = UserMemory(
        id=str(uuid.uuid4()),
        category=body.category,
        content=body.content,
        confidence=body.confidence,
        source="user",
        created_at=datetime.utcnow(),
    )
    db.add(mem)
    db.commit()
    db.refresh(mem)
    return mem

@router.patch("/{memory_id}", response_model=MemoryResponse)
def update_memory(memory_id: str, body: MemoryUpdate, db: Session = Depends(get_db)):
    mem = db.get(UserMemory, memory_id)
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")
    mem.is_active = body.is_active
    db.commit()
    db.refresh(mem)
    return mem

@router.delete("/{memory_id}")
def delete_memory(memory_id: str, db: Session = Depends(get_db)):
    mem = db.get(UserMemory, memory_id)
    if not mem:
        raise HTTPException(status_code=404, detail="Memory not found")
    db.delete(mem)
    db.commit()
    return {"deleted": memory_id}
