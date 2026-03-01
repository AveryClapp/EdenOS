import uuid
from datetime import time
from sqlalchemy import String, Integer, Time, Boolean
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class AvailabilityWindow(Base):
    """
    Defines when the user is available to work.

    day_of_week = None means the window applies to every day.
    day_of_week = 0-6 (0 = Monday) scopes the window to that weekday.

    If no rows exist, the scheduler defaults to 6am-10pm every day.
    """
    __tablename__ = "availability_windows"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    day_of_week: Mapped[int | None] = mapped_column(Integer, nullable=True)  # 0=Mon-6=Sun, None=every day
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_available: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
