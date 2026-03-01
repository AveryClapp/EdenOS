import uuid
from sqlalchemy import String, Float, Enum, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str] = mapped_column(
        Enum("research", "engineering", "academic", "athletic", "career", "personal", name="project_category"),
        nullable=False,
    )
    motivation: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    goal_id: Mapped[str] = mapped_column(String(36), ForeignKey("goals.id"), nullable=False)
    priority_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    status: Mapped[str] = mapped_column(
        Enum("active", "paused", "done", "dropped", name="project_status"),
        nullable=False,
        default="active",
    )
    estimated_hours_remaining: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    github_repo: Mapped[str | None] = mapped_column(String(500), nullable=True)

    goal: Mapped["Goal"] = relationship("Goal", back_populates="projects")
    tasks: Mapped[list["Task"]] = relationship("Task", back_populates="project")
