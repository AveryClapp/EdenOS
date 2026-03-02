import { apiFetch } from './client'
import type { UserProfile, EnergyDefault } from '../types'

export const getUserProfile = () =>
  apiFetch<UserProfile>('/user-profile')

export const updateUserProfile = (body: {
  wake_hour: number
  chronotype: string
  autonomy_level?: number
  planning_time?: string
  planning_auto_lock_minutes?: number
}) =>
  apiFetch<UserProfile>('/user-profile', {
    method: 'PUT',
    body: JSON.stringify(body),
  })

export const getEnergyDefaults = () =>
  apiFetch<EnergyDefault[]>('/user-profile/energy-defaults')
