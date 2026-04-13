from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.intelligence.context import build_context_snapshot

router = APIRouter(prefix="/api", tags=["context"])


@router.get("/context")
def get_context(db: Session = Depends(get_db)):
    """
    Returns the full context snapshot — all domains Eden knows about.
    Used by CommandCenter and any frontend panel that needs current state.
    """
    return build_context_snapshot(db)
