import { apiFetch } from './client'
import type { Alert, ProposedAction } from '../types'

type ChatResponse = { content: string; reasoning: string; proposed_actions: ProposedAction[] }

export const sendMessage = (
  message: string,
  mode: 'chat' | 'planning' = 'chat',
  planningDate?: string,
) =>
  apiFetch<ChatResponse>('/chat', {
    method: 'POST',
    body: JSON.stringify({ message, mode, planning_date: planningDate ?? null }),
  })

export const executeActions = (
  actions: Array<{ tool_use_id: string; name: string; input: Record<string, unknown>; approved: boolean }>,
) =>
  apiFetch<{ executed: number; skipped: number }>('/chat/actions/execute', {
    method: 'POST',
    body: JSON.stringify({ actions }),
  })

export const getAlerts = () =>
  apiFetch<Alert[]>('/chat/alerts')
