export type GoalTier = 'long' | 'mid'
export type GoalStatus = 'active' | 'paused' | 'done' | 'dropped'
export type ProjectStatus = 'active' | 'paused' | 'done' | 'dropped'
export type TaskStatus = 'backlog' | 'active' | 'in_progress' | 'done' | 'deferred'
export type ProjectCategory = 'research' | 'engineering' | 'academic' | 'athletic' | 'career' | 'personal'

export interface Goal {
  id: string
  title: string
  description: string | null
  tier: GoalTier
  parent_id: string | null
  weight: number
  target_date: string
  status: GoalStatus
  created_at: string
}

export interface Project {
  id: string
  title: string
  category: ProjectCategory
  motivation: string | null
  goal_id: string
  priority_score: number
  status: ProjectStatus
  estimated_hours_remaining: number
  github_repo: string | null
}

export interface Task {
  id: string
  project_id: string
  title: string
  description: string | null
  status: TaskStatus
  cognitive_load: number
  estimated_minutes: number
  actual_minutes: number | null
  deadline: string | null
  recurrence_rule: string | null
  source: string
  created_at: string
}

export interface ScheduleBlock {
  id: string
  task_id: string | null
  calendar_event_id: string | null
  date: string
  start_time: string
  end_time: string
  auto_generated: boolean
  overridden_by_user: boolean
}

export interface ScheduleResponse {
  today: ScheduleBlock[]
  week: ScheduleBlock[]
}

export interface Alert {
  severity: 'critical' | 'high' | 'medium' | 'low'
  message: string
  task_id?: string
}

export interface ProposedAction {
  tool_use_id: string
  name: string
  input: Record<string, unknown>
  description: string
}

export interface ChatMessage {
  role: 'user' | 'eden'
  content: string
  reasoning?: string
  proposed_actions?: ProposedAction[]
}

export interface ScheduleRunResult {
  blocks_cleared: number
  blocks_created: number
}

export interface PlanDayResult {
  summary: string
  reasoning: string
  created_projects: number
  created_tasks: number
  blocks_created: number
}

export interface EnergyProfileEntry {
  id: string
  hour_of_day: number
  day_of_week: number
  energy_level: number
  is_post_hard_workout: boolean
  notes: string | null
}

export interface AvailabilityWindow {
  id: string
  day_of_week: number | null
  start_time: string   // "HH:MM:SS" from FastAPI
  end_time: string
  is_available: boolean
  note: string | null
}
