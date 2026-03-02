import { apiFetch } from './client'
import type { Task } from '../types'

export const listTasks = (projectId?: string) =>
  apiFetch<Task[]>(projectId ? `/tasks?project_id=${projectId}` : '/tasks')

export const createTask = (body: {
  project_id: string
  title: string
  cognitive_load: number
  estimated_minutes: number
  description?: string
  deadline?: string
  dependency_ids?: string[]
  recurrence_rule?: string
}) => apiFetch<Task>('/tasks', { method: 'POST', body: JSON.stringify(body) })

export const updateTask = (
  id: string,
  body: Partial<{
    title: string
    description: string | null
    cognitive_load: number
    estimated_minutes: number
    deadline: string | null
    status: 'backlog' | 'active' | 'in_progress' | 'done' | 'deferred'
    dependency_ids: string[]
  }>,
) => apiFetch<Task>(`/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const deleteTask = (id: string) =>
  apiFetch<void>(`/tasks/${id}`, { method: 'DELETE' })

export const completeTask = (
  id: string,
  body: {
    actual_minutes: number
    completion_quality: number
    energy_level_at_start: number
  },
) => apiFetch<Task>(`/tasks/${id}/complete`, { method: 'POST', body: JSON.stringify(body) })
