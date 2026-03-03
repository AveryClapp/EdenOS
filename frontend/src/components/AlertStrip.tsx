import { useQuery } from '@tanstack/react-query'
import { getAlerts } from '../api/chat'
import type { Alert } from '../types'

const COLOR: Record<string, string> = {
  critical: 'text-red-500',
  high: 'text-amber-700',
  medium: 'text-yellow-700',
  low: 'text-stone-500',
}

export default function AlertStrip() {
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: getAlerts,
    refetchInterval: 60_000,
  })

  if (alerts.length === 0) return null

  return (
    <div className="flex gap-4 px-6 py-2 overflow-x-auto text-xs shrink-0" style={{ borderBottom: '1px solid #b0a085' }}>
      {alerts.map((a, i) => (
        <span key={i} className={`shrink-0 ${COLOR[a.severity] ?? 'text-stone-500'}`}>
          ⚠ {a.message}
        </span>
      ))}
    </div>
  )
}
