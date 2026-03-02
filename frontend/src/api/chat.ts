import { apiFetch } from './client'
import type { Alert, ProposedAction } from '../types'

export const sendMessage = (message: string) =>
  apiFetch<{ content: string; reasoning: string; proposed_actions: ProposedAction[] }>(
    '/chat',
    { method: 'POST', body: JSON.stringify({ message }) },
  )

export const executeActions = (
  actions: Array<{ tool_use_id: string; name: string; input: Record<string, unknown>; approved: boolean }>,
) =>
  apiFetch<{ executed: number; skipped: number }>('/chat/actions/execute', {
    method: 'POST',
    body: JSON.stringify({ actions }),
  })

export const getAlerts = () =>
  apiFetch<Alert[]>('/chat/alerts')
