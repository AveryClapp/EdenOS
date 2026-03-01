import uuid
from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Enum, ForeignKey, Table, Column
from sqlalchemy.orm import Mapped, mapped_column, relationship
from backend.db import Base


# Association table for task dependencies (self-referential M2M)
task_dependencies = Table(
    "task_dependencies",
    Base.metadata,
    Column("task_id", String(36), ForeignKey("tasks.id"), primary_key=True),
    Column("depends_on_id", String(36), ForeignKey("tasks.id"), primary_key=True),
)


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    project_id: Mapped[str] = mapped_column(String(36), ForeignKey("projects.id"), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(String(4000), nullable=True)
    status: Mapped[str] = mapped_column(
        Enum("backlog", "active", "in_progress", "done", "deferred", name="task_status"),
        nullable=False,
        default="backlog",
    )
    cognitive_load: Mapped[int] = mapped_column(Integer, nullable=False)  # 1, 2, or 3
    estimated_minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    actual_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    deadline: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    recurrence_rule: Mapped[str | None] = mapped_column(String(500), nullable=True)
    source: Mapped[str] = mapped_column(
        Enum("manual", "github", "gcal", name="task_source"),
        nullable=False,
        default="manual",
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, default=datetime.utcnow)

    project: Mapped["Project"] = relationship("Project", back_populates="tasks")

    dependencies: Mapped[list["Task"]] = relationship(
        "Task",
        secondary=task_dependencies,
        primaryjoin="Task.id == task_dependencies.c.task_id",
        secondaryjoin="Task.id == task_dependencies.c.depends_on_id",
        backref="dependents",
    )

    schedule_blocks: Mapped[list["ScheduleBlock"]] = relationship("ScheduleBlock", back_populates="task")

    learning_records: Mapped[list["LearningRecord"]] = relationship("LearningRecord", back_populates="task")

