import { apiFetch } from './client'
import type { GCalStatus } from '../types'

export const getGCalStatus = () =>
  apiFetch<GCalStatus>('/gcal/status')

export const syncGCal = () =>
  apiFetch<Record<string, unknown>>('/gcal/sync', { method: 'POST' })

export const connectGCal = () => {
  window.location.href = `${import.meta.env.VITE_API_BASE ?? 'http://localhost:8500'}/api/gcal/connect`
}
