from __future__ import annotations
from datetime import date, datetime
from typing import Literal
from pydantic import BaseModel


# --- Goal ---

class GoalCreate(BaseModel):
    title: str
    description: str | None = None
    tier: Literal["long", "mid"]
    parent_id: str | None = None
    weight: float = 1.0
    target_date: date


class GoalUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    tier: Literal["long", "mid"] | None = None
    parent_id: str | None = None
    weight: float | None = None
    target_date: date | None = None
    status: Literal["active", "paused", "done", "dropped"] | None = None


class GoalResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    description: str | None
    tier: str
    parent_id: str | None
    weight: float
    target_date: date
    status: str
    created_at: datetime


# --- Project ---

class ProjectCreate(BaseModel):
    title: str
    category: Literal["research", "engineering", "academic", "athletic", "career", "personal"]
    motivation: str | None = None
    goal_id: str
    estimated_hours_remaining: float = 0.0
    github_repo: str | None = None


class ProjectUpdate(BaseModel):
    title: str | None = None
    category: Literal["research", "engineering", "academic", "athletic", "career", "personal"] | None = None
    motivation: str | None = None
    goal_id: str | None = None
    estimated_hours_remaining: float | None = None
    github_repo: str | None = None
    status: Literal["active", "paused", "done", "dropped"] | None = None


class ProjectResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    title: str
    category: str
    motivation: str | None
    goal_id: str
    priority_score: float
    status: str
    estimated_hours_remaining: float
    github_repo: str | None


# --- Task ---

class TaskCreate(BaseModel):
    project_id: str
    title: str
    description: str | None = None
    cognitive_load: int  # 1, 2, or 3
    estimated_minutes: int
    deadline: datetime | None = None
    dependency_ids: list[str] = []
    recurrence_rule: str | None = None
    source: Literal["manual", "github", "gcal"] = "manual"


class TaskUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    cognitive_load: int | None = None
    estimated_minutes: int | None = None
    deadline: datetime | None = None
    status: Literal["backlog", "active", "in_progress", "done", "deferred"] | None = None
    recurrence_rule: str | None = None


class TaskComplete(BaseModel):
    actual_minutes: int
    completion_quality: int   # 1–5
    energy_level_at_start: int  # 1–5


class TaskResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    project_id: str
    title: str
    description: str | None
    status: str
    cognitive_load: int
    estimated_minutes: int
    actual_minutes: int | None
    deadline: datetime | None
    source: str
    created_at: datetime


# --- Schedule ---

class ScheduleBlockResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    task_id: str | None
    calendar_event_id: str | None
    date: date
    start_time: str   # serialized as HH:MM:SS string
    end_time: str
    auto_generated: bool
    overridden_by_user: bool


class ScheduleOverride(BaseModel):
    task_id: str | None = None
    date: date
    start_time: str  # "HH:MM"
    end_time: str    # "HH:MM"


class ScheduleRunResponse(BaseModel):
    blocks_cleared: int
    blocks_created: int


# --- Chat ---

class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    content: str
    reasoning: str
