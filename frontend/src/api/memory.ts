import { apiFetch } from './client'
import type { UserMemory } from '../types'

export const listMemory = () =>
  apiFetch<UserMemory[]>('/memory')

export const createMemory = (body: {
  category: UserMemory['category']
  content: string
  confidence?: number
}) => apiFetch<UserMemory>('/memory', { method: 'POST', body: JSON.stringify(body) })

export const deleteMemory = (id: string) =>
  apiFetch<{ deleted: string }>(`/memory/${id}`, { method: 'DELETE' })

export const toggleMemory = (id: string, is_active: boolean) =>
  apiFetch<UserMemory>(`/memory/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ is_active }),
  })
