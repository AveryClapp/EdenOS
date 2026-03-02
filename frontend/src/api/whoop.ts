import { apiFetch } from './client'
import type { WhoopStatus } from '../types'

export const getWhoopStatus = () =>
  apiFetch<WhoopStatus>('/whoop/status')

export const syncWhoop = () =>
  apiFetch<Record<string, unknown>>('/whoop/sync', { method: 'POST' })

// Connect navigates the browser to the OAuth URL — not an apiFetch call
export const connectWhoop = () => {
  window.location.href = `${import.meta.env.VITE_API_BASE ?? 'http://localhost:8000'}/api/whoop/connect`
}
