import { apiFetch } from './client'
import type { Goal } from '../types'

export const listGoals = () =>
  apiFetch<Goal[]>('/goals')

export const createGoal = (body: {
  title: string
  tier: 'long' | 'mid'
  weight: number
  target_date: string
  description?: string
  parent_id?: string
}) => apiFetch<Goal>('/goals', { method: 'POST', body: JSON.stringify(body) })

export const updateGoal = (
  id: string,
  body: Partial<{
    title: string
    description: string
    tier: 'long' | 'mid'
    parent_id: string | null
    weight: number
    target_date: string
    status: 'active' | 'paused' | 'done' | 'dropped'
  }>,
) => apiFetch<Goal>(`/goals/${id}`, { method: 'PATCH', body: JSON.stringify(body) })
