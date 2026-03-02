import uuid
from datetime import date, datetime
from sqlalchemy import String, Integer, Float, Date, DateTime
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class WhoopDaily(Base):
    __tablename__ = "whoop_daily"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    recovery_score: Mapped[int | None] = mapped_column(Integer, nullable=True)   # 0–100
    hrv_rms: Mapped[float | None] = mapped_column(Float, nullable=True)
    resting_hr: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sleep_quality_score: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0–100
    actual_wake_time: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    strain_score: Mapped[float | None] = mapped_column(Float, nullable=True)      # 0–21
    synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)
