import { apiFetch } from './client'
import type { ScheduleResponse, ScheduleRunResult, PlanDayResult, ScheduleExplanation } from '../types'

export const getSchedule = (start?: string) =>
  apiFetch<ScheduleResponse>(start ? `/schedule?start=${start}` : '/schedule')

export const runScheduler = () =>
  apiFetch<ScheduleRunResult>('/schedule/run', { method: 'POST' })

export const planDay = (intent: string) =>
  apiFetch<PlanDayResult>('/schedule/plan-day', { method: 'POST', body: JSON.stringify({ intent }) })

export const createOverride = (body: {
  date: string
  start_time: string
  end_time: string
  task_id?: string
  label?: string
}) => apiFetch<unknown>('/schedule/override', { method: 'POST', body: JSON.stringify(body) })

export const getExplanation = (date?: string) =>
  apiFetch<ScheduleExplanation>(date ? `/schedule/explanation?date=${date}` : '/schedule/explanation')
