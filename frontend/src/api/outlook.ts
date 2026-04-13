import { apiFetch } from './client'
import type { OutlookStatus } from '../types'

export const getOutlookStatus = () =>
  apiFetch<OutlookStatus>('/outlook/status')

export const syncOutlook = () =>
  apiFetch<Record<string, unknown>>('/outlook/sync', { method: 'POST' })

export const connectOutlook = () => {
  window.location.href = `${import.meta.env.VITE_API_BASE ?? 'http://localhost:8500'}/api/outlook/connect`
}
