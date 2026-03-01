import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class LearningRecord(Base):
    """Append-only. Never update or delete rows — add new rows for new data."""
    __tablename__ = "learning_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=False)
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    energy_level_at_start: Mapped[int] = mapped_column(Integer, nullable=False)  # 1–5
    completion_quality: Mapped[int] = mapped_column(Integer, nullable=False)     # 1–5
    recorded_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    task: Mapped["Task"] = relationship("Task", back_populates="learning_records")
