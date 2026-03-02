import { apiFetch } from './client'
import type { EnergyProfileEntry } from '../types'

export const getEnergyProfile = () =>
  apiFetch<EnergyProfileEntry[]>('/energy-profile')

export const setEnergyProfile = (
  entries: Array<{
    hour_of_day: number
    day_of_week: number
    energy_level: number
    is_post_hard_workout?: boolean
    notes?: string | null
  }>,
) =>
  apiFetch<EnergyProfileEntry[]>('/energy-profile', {
    method: 'PUT',
    body: JSON.stringify({ entries }),
  })
