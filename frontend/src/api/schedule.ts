import { apiFetch } from './client'
import type { ScheduleResponse, ScheduleRunResult } from '../types'

export const getSchedule = () =>
  apiFetch<ScheduleResponse>('/schedule')

export const runScheduler = () =>
  apiFetch<ScheduleRunResult>('/schedule/run', { method: 'POST' })

export const createOverride = (body: {
  date: string
  start_time: string
  end_time: string
  task_id?: string
}) => apiFetch<unknown>('/schedule/override', { method: 'POST', body: JSON.stringify(body) })
