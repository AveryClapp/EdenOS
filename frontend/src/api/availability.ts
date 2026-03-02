import { apiFetch } from './client'
import type { AvailabilityWindow } from '../types'

export const listAvailability = () =>
  apiFetch<AvailabilityWindow[]>('/availability')

export const createAvailability = (body: {
  day_of_week?: number | null
  start_time: string
  end_time: string
  is_available?: boolean
  note?: string | null
}) =>
  apiFetch<AvailabilityWindow>('/availability', {
    method: 'POST',
    body: JSON.stringify(body),
  })

export const deleteAvailability = (id: string) =>
  apiFetch<void>(`/availability/${id}`, { method: 'DELETE' })
