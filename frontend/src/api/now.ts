import { apiFetch } from './client'
import type { NowSuggestion } from '../types'

export const getNowSuggestion = () =>
  apiFetch<NowSuggestion>('/now')
