import uuid
from datetime import datetime
from sqlalchemy import String, Text, Float, DateTime, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class RLEpisode(Base):
    __tablename__ = "rl_episodes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    scheduled_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)   # JSON
    action: Mapped[str] = mapped_column(Text, nullable=False)  # JSON
    reward: Mapped[float | None] = mapped_column(Float, nullable=True)
    reward_computed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    episode_complete: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
