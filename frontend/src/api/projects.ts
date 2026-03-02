import { apiFetch } from './client'
import type { Project } from '../types'

export const listProjects = () =>
  apiFetch<Project[]>('/projects')

export const createProject = (body: {
  title: string
  category: string
  goal_id: string
  estimated_hours_remaining?: number
  motivation?: string
  github_repo?: string
}) => apiFetch<Project>('/projects', { method: 'POST', body: JSON.stringify(body) })

export const updateProject = (
  id: string,
  body: Partial<{
    title: string
    category: string
    motivation: string
    goal_id: string
    estimated_hours_remaining: number
    github_repo: string
    status: 'active' | 'paused' | 'done' | 'dropped'
  }>,
) => apiFetch<Project>(`/projects/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
