import uuid
from sqlalchemy import String, Integer, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class EnergyProfile(Base):
    __tablename__ = "energy_profiles"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    hour_of_day: Mapped[int] = mapped_column(Integer, nullable=False)   # 0–23
    day_of_week: Mapped[int] = mapped_column(Integer, nullable=False)   # 0 = Monday
    energy_level: Mapped[int] = mapped_column(Integer, nullable=False)  # 1–5
    is_post_hard_workout: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
