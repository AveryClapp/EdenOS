import { apiFetch } from './client'
import type { DraftBlock, PlanProposal } from '../types'

export const generatePlan = (targetDate: string) =>
  apiFetch<PlanProposal>(`/plan/generate?target_date=${targetDate}`, { method: 'POST' })

export const lockPlan = (targetDate: string) =>
  apiFetch<{ locked: number; date: string }>(`/plan/lock?target_date=${targetDate}`, { method: 'POST' })

export const discardPlan = (targetDate: string) =>
  apiFetch<{ discarded: number; date: string }>(`/plan/${targetDate}`, { method: 'DELETE' })

export interface WeekPlanProposal {
  days: Array<{ date: string; blocks: DraftBlock[]; summary: string }>
  week_start: string
}

export const generateWeekPlan = (startDate: string) =>
  apiFetch<WeekPlanProposal>(`/plan/generate-week?start_date=${startDate}`, { method: 'POST' })

export const lockWeekPlan = (startDate: string) =>
  apiFetch<{ locked: number; week_start: string }>(`/plan/lock-week?start_date=${startDate}`, { method: 'POST' })
