import uuid
from datetime import date, time
from sqlalchemy import String, Date, Time, Boolean, ForeignKey, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class ScheduleBlock(Base):
    __tablename__ = "schedule_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    task_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("tasks.id"), nullable=True)
    calendar_event_id: Mapped[str | None] = mapped_column(String(500), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    auto_generated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    overridden_by_user: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    is_draft: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    label: Mapped[str | None] = mapped_column(String(200), nullable=True)
    reasoning: Mapped[str | None] = mapped_column(Text, nullable=True)

    task: Mapped["Task | None"] = relationship("Task", back_populates="schedule_blocks")
