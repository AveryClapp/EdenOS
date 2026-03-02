from __future__ import annotations
from datetime import date, datetime, time
from typing import Literal
from pydantic import BaseModel, field_validator, model_validator


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
    dependency_ids: list[str] | None = None


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
    recurrence_rule: str | None
    source: str
    created_at: datetime
    dependency_ids: list[str] = []

    @model_validator(mode='before')
    @classmethod
    def extract_dependency_ids(cls, data):
        # When given an ORM object, convert to dict and pull dependency_ids
        # from the relationship before Pydantic processes it.
        if hasattr(data, '__table__'):
            result = {col.name: getattr(data, col.name) for col in data.__table__.columns}
            result['dependency_ids'] = [d.id for d in getattr(data, 'dependencies', [])]
            return result
        return data


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


class PlanDayRequest(BaseModel):
    intent: str


class PlanDayResponse(BaseModel):
    summary: str
    reasoning: str
    created_projects: int
    created_tasks: int
    blocks_created: int


# --- Chat ---

class ChatRequest(BaseModel):
    message: str
    mode: Literal["chat", "planning"] = "chat"
    planning_date: date | None = None


class ProposedAction(BaseModel):
    tool_use_id: str
    name: str
    input: dict
    description: str  # human-readable summary


class ChatResponse(BaseModel):
    content: str
    reasoning: str
    proposed_actions: list[ProposedAction] = []


class ExecuteActionItem(BaseModel):
    tool_use_id: str
    name: str
    input: dict
    approved: bool


class ExecuteActionsRequest(BaseModel):
    actions: list[ExecuteActionItem]


# --- Energy Profile ---

class EnergyProfileEntry(BaseModel):
    hour_of_day: int   # 0–23
    day_of_week: int   # 0=Mon, 6=Sun
    energy_level: int  # 1–5
    is_post_hard_workout: bool = False
    notes: str | None = None


class EnergyProfileBulkSet(BaseModel):
    entries: list[EnergyProfileEntry]


class EnergyProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    hour_of_day: int
    day_of_week: int
    energy_level: int
    is_post_hard_workout: bool
    notes: str | None


# --- Availability Windows ---

class AvailabilityCreate(BaseModel):
    day_of_week: int | None = None   # None = every day; 0=Mon–6=Sun
    start_time: str                  # "HH:MM"
    end_time: str                    # "HH:MM"
    is_available: bool = True
    note: str | None = None


class AvailabilityUpdate(BaseModel):
    day_of_week: int | None = None
    start_time: str | None = None
    end_time: str | None = None
    is_available: bool | None = None
    note: str | None = None


class AvailabilityResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    day_of_week: int | None
    start_time: time
    end_time: time
    is_available: bool
    note: str | None


# --- User Profile ---

class UserProfileUpdate(BaseModel):
    wake_hour: int
    chronotype: Literal["early", "intermediate", "late"]
    autonomy_level: int = 2
    planning_time: str = "21:00"
    planning_auto_lock_minutes: int = 60

    @field_validator("wake_hour")
    @classmethod
    def validate_wake_hour(cls, v: int) -> int:
        if not 0 <= v <= 23:
            raise ValueError("wake_hour must be 0–23")
        return v

    @field_validator("autonomy_level")
    @classmethod
    def validate_autonomy_level(cls, v: int) -> int:
        if not 1 <= v <= 5:
            raise ValueError("autonomy_level must be 1–5")
        return v


class UserProfileResponse(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    wake_hour: int
    chronotype: str
    autonomy_level: int
    planning_time: str
    planning_auto_lock_minutes: int


# --- Whoop ---

class WhoopStatusResponse(BaseModel):
    connected: bool
    today: dict | None = None  # WhoopDaily fields if synced today


# --- Memory ---

class MemoryCreate(BaseModel):
    category: Literal["preference", "constraint", "goal_context", "personal", "signal"]
    content: str
    confidence: float = 1.0

class MemoryUpdate(BaseModel):
    is_active: bool

class MemoryResponse(BaseModel):
    model_config = {"from_attributes": True}
    id: str
    category: str
    content: str
    confidence: float
    source: str
    created_at: datetime
    is_active: bool
