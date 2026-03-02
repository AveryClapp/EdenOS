import { apiFetch } from './client'

export const syncGitHub = (projectId: string) =>
  apiFetch<{ imported: number; skipped: number }>(
    `/github/sync?project_id=${projectId}`,
    { method: 'POST' },
  )
