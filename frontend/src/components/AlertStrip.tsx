import { useQuery } from '@tanstack/react-query'
import { getAlerts } from '../api/chat'
import type { Alert } from '../types'

const COLOR: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-amber-400',
  medium: 'text-yellow-500',
  low: 'text-zinc-400',
}

export default function AlertStrip() {
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: getAlerts,
    refetchInterval: 60_000,
  })

  if (alerts.length === 0) return null

  return (
    <div className="flex gap-4 px-6 py-2 border-b border-zinc-800 overflow-x-auto text-xs shrink-0">
      {alerts.map((a, i) => (
        <span key={i} className={`shrink-0 ${COLOR[a.severity] ?? 'text-zinc-400'}`}>
          ⚠ {a.message}
        </span>
      ))}
    </div>
  )
}
