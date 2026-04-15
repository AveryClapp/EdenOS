import uuid
from datetime import date, datetime
from typing import TYPE_CHECKING
from sqlalchemy import String, Text, Date, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base

if TYPE_CHECKING:
    from backend.models.commitment import Commitment


class Person(Base):
    __tablename__ = "people"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    relationship_type: Mapped[str] = mapped_column(String(20), nullable=False)  # friend|colleague|mentor|family|acquaintance
    context: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_contact_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    commitments: Mapped[list["Commitment"]] = relationship(
        "Commitment", back_populates="person", cascade="all, delete-orphan"
    )
