import uuid
from datetime import datetime, date
from sqlalchemy import String, Date, Text, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class PlanExplanation(Base):
    __tablename__ = "plan_explanations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    date: Mapped[date] = mapped_column(Date, nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    full_reasoning: Mapped[str] = mapped_column(Text, nullable=False)  # JSON string
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
