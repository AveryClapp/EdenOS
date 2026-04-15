import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface ContextSlice {
  whoop_today: { recovery_score: number; recommendation: 'green' | 'yellow' | 'red' } | null
  alerts: { severity: string }[]
}

const fetchContext = (): Promise<ContextSlice> =>
  fetch('/api/context').then(r => { if (!r.ok) throw new Error(); return r.json() })

const DOT = <span style={{ color: 'rgba(0,186,220,0.35)', margin: '0 6px', fontSize: 8 }}>◆</span>

export default function AmbientBar() {
  const [time, setTime] = useState('')
  const [date, setDate] = useState('')

  // Clock — 1s tick, no backend needed
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
      setDate(now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase())
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Shares the same cache as CommandCenter — zero extra requests
  const { data } = useQuery<ContextSlice>({
    queryKey: ['context'],
    queryFn: fetchContext,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  const whoop = data?.whoop_today ?? null
  const alertCount = data?.alerts?.length ?? 0

  const recoveryColor =
    whoop?.recommendation === 'green'  ? '#00cc6a'
    : whoop?.recommendation === 'yellow' ? '#ffb300'
    : whoop?.recommendation === 'red'    ? '#ff3535'
    : 'rgba(0,186,220,0.3)'

  return (
    <div
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'rgba(6, 14, 26, 0.99)',
        borderBottom: '1px solid rgba(0,186,220,0.1)',
        flexShrink: 0,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        letterSpacing: '0.06em',
        userSelect: 'none',
        position: 'relative',
        zIndex: 10,
      }}
    >
      {/* Left — system ID */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{
          color: 'rgba(0,186,220,0.65)',
          letterSpacing: '0.18em',
          fontSize: 9,
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
        }}>
          EDEN OS
        </span>
        {DOT}
        <span style={{ color: '#90c4dd' }}>v{__APP_VERSION__}</span>
        {DOT}
        <span style={{
          display: 'inline-block',
          width: 5, height: 5,
          borderRadius: '50%',
          background: '#00cc6a',
          animation: 'pulse-dot 2.5s ease-in-out infinite',
          marginRight: 5,
        }} />
        <span style={{ color: '#527e96', fontSize: 9 }}>ONLINE</span>
      </div>

      {/* Center — live clock */}
      <div style={{
        position: 'absolute',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
      }}>
        <span style={{
          color: '#00badc',
          letterSpacing: '0.12em',
          fontSize: 11,
          textShadow: '0 0 12px rgba(0,186,220,0.4)',
        }}>
          {time}
        </span>
        {DOT}
        <span style={{ color: '#527e96', letterSpacing: '0.1em' }}>{date}</span>
      </div>

      {/* Right — biometrics + alerts */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {whoop != null && (
          <>
            <span style={{ color: '#527e96', fontSize: 9, letterSpacing: '0.12em' }}>RECOVERY</span>
            <span style={{ color: recoveryColor, marginLeft: 4, fontSize: 10 }}>
              {whoop.recovery_score}%
            </span>
            {DOT}
          </>
        )}
        {alertCount > 0 && (
          <>
            <span style={{ color: '#ffb300' }}>
              {alertCount} ALERT{alertCount !== 1 ? 'S' : ''}
            </span>
            {DOT}
          </>
        )}
        <span style={{ color: 'rgba(0,186,220,0.4)', fontSize: 9, marginLeft: 2 }}>◢</span>
      </div>
    </div>
  )
}
