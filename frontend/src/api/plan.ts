import { apiFetch } from './client'
import type { PlanProposal } from '../types'

export const generatePlan = (targetDate: string) =>
  apiFetch<PlanProposal>(`/plan/generate?target_date=${targetDate}`, { method: 'POST' })

export const lockPlan = (targetDate: string) =>
  apiFetch<{ locked: number; date: string }>(`/plan/lock?target_date=${targetDate}`, { method: 'POST' })

export const discardPlan = (targetDate: string) =>
  apiFetch<{ discarded: number; date: string }>(`/plan/${targetDate}`, { method: 'DELETE' })
