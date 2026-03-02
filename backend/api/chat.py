from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.db import get_db
from backend.intelligence.client import EdenClient
from backend.api.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/api/chat", tags=["chat"])


def get_eden_client() -> EdenClient:
    return EdenClient()


@router.post("", response_model=ChatResponse)
def chat(body: ChatRequest, db: Session = Depends(get_db), eden: EdenClient = Depends(get_eden_client)):
    result = eden.chat(body.message, db)
    return ChatResponse(
        content=result.get("content", ""),
        reasoning=result.get("reasoning", ""),
    )


@router.get("/alerts")
def get_alerts(db: Session = Depends(get_db), eden: EdenClient = Depends(get_eden_client)):
    return eden.get_alerts(db)
