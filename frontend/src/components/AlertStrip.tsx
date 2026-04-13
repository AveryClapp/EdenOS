import { useQuery } from '@tanstack/react-query'
import { getAlerts } from '../api/chat'
import type { Alert } from '../types'

const COLOR: Record<string, string> = {
  critical: '#ef4444',
  high: '#f59e0b',
  medium: '#71717a',
  low: '#52525b',
}

export default function AlertStrip() {
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: getAlerts,
    refetchInterval: 60_000,
  })

  if (alerts.length === 0) return null

  return (
    <div className="flex gap-4 px-6 py-2 overflow-x-auto text-xs shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
      {alerts.map((a, i) => (
        <span key={i} style={{ color: COLOR[a.severity] ?? '#52525b', flexShrink: 0 }}>
          ⚠ {a.message}
        </span>
      ))}
    </div>
  )
}
