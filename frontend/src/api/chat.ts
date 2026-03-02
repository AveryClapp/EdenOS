import { apiFetch } from './client'
import type { Alert } from '../types'

export const sendMessage = (message: string) =>
  apiFetch<{ content: string; reasoning: string }>('/chat', {
    method: 'POST',
    body: JSON.stringify({ message }),
  })

export const getAlerts = () =>
  apiFetch<Alert[]>('/chat/alerts')
