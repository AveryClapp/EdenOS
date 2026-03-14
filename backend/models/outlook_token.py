import uuid
from datetime import datetime
from sqlalchemy import String, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class OutlookToken(Base):
    __tablename__ = "outlook_tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    access_token: Mapped[str] = mapped_column(String(2000), nullable=False)
    refresh_token: Mapped[str] = mapped_column(String(2000), nullable=False)
    token_type: Mapped[str] = mapped_column(String(50), nullable=False, default="Bearer")
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    scope: Mapped[str] = mapped_column(String(500), nullable=False, default="")
