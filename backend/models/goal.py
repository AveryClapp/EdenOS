import uuid
from datetime import date, datetime
from sqlalchemy import String, Float, Date, DateTime, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class Goal(Base):
    __tablename__ = "goals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    tier: Mapped[str] = mapped_column(Enum("long", "mid", name="goal_tier"), nullable=False)
    parent_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("goals.id"), nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    target_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum("active", "paused", "done", "dropped", name="goal_status"),
        nullable=False,
        default="active",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    parent: Mapped["Goal | None"] = relationship("Goal", remote_side="Goal.id", back_populates="children")
    children: Mapped[list["Goal"]] = relationship("Goal", back_populates="parent")
