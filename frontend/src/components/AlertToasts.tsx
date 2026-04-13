import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'

interface Alert {
  type: string
  severity: 'critical' | 'high' | 'medium'
  message: string
  task_id?: string
  goal_id?: string
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3535',
  high: '#ffb300',
  medium: '#00badc',
}

const SEV_ICON: Record<string, string> = {
  critical: '◈',
  high: '◆',
  medium: '◇',
}

export default function AlertToasts() {
  const [visible, setVisible] = useState<Array<Alert & { id: number }>>([])
  const seenRef = useRef(new Set<string>())
  const counterRef = useRef(0)

  const { data } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: () => fetch('/api/chat/alerts').then(r => r.json()),
    refetchInterval: 120_000,
    staleTime: 60_000,
  })

  useEffect(() => {
    if (!data) return
    const newAlerts = data.filter(a => {
      const key = `${a.type}:${a.task_id ?? a.goal_id ?? a.message.slice(0, 40)}`
      if (seenRef.current.has(key)) return false
      seenRef.current.add(key)
      return true
    })

    if (newAlerts.length === 0) return

    const toAdd = newAlerts.slice(0, 3).map(a => ({ ...a, id: counterRef.current++ }))
    setVisible(v => [...v, ...toAdd])

    // Auto-dismiss after 8s
    toAdd.forEach(a => {
      setTimeout(() => dismiss(a.id), 8000)
    })
  }, [data])

  function dismiss(id: number) {
    setVisible(v => v.filter(a => a.id !== id))
  }

  if (visible.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 20,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      zIndex: 100,
      pointerEvents: 'none',
    }}>
      {visible.map(alert => (
        <div
          key={alert.id}
          className="fade-in"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '10px 14px',
            background: 'rgba(2, 8, 15, 0.97)',
            border: `1px solid ${SEV_COLOR[alert.severity] ?? '#316a86'}33`,
            borderLeft: `2px solid ${SEV_COLOR[alert.severity] ?? '#316a86'}`,
            borderRadius: 2,
            minWidth: 280,
            maxWidth: 420,
            pointerEvents: 'all',
            backdropFilter: 'blur(8px)',
          }}
        >
          <span style={{ color: SEV_COLOR[alert.severity], fontSize: 11, flexShrink: 0, marginTop: 1 }}>
            {SEV_ICON[alert.severity]}
          </span>
          <p style={{ flex: 1, fontSize: 12, fontWeight: 300, color: '#9dd4ea', margin: 0, lineHeight: 1.5 }}>
            {alert.message}
          </p>
          <button
            onClick={() => dismiss(alert.id)}
            style={{ flexShrink: 0, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', lineHeight: 1, marginTop: 1 }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
