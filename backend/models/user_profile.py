import uuid
from sqlalchemy import String, Integer
from sqlalchemy.orm import Mapped, mapped_column
from backend.db import Base


class UserProfile(Base):
    __tablename__ = "user_profile"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    wake_hour: Mapped[int] = mapped_column(Integer, nullable=False, default=7)
    chronotype: Mapped[str] = mapped_column(String(20), nullable=False, default="intermediate")
