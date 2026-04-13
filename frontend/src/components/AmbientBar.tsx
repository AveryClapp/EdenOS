import { useEffect, useState } from 'react'

interface AmbientState {
  time: string
  date: string
  recovery: number | null
  recoveryRec: 'green' | 'yellow' | 'red' | null
  alertCount: number
}

const DOT = <span style={{ color: 'rgba(0,186,220,0.2)', margin: '0 6px', fontSize: 8 }}>◆</span>

export default function AmbientBar() {
  const [state, setState] = useState<AmbientState>({
    time: '',
    date: '',
    recovery: null,
    recoveryRec: null,
    alertCount: 0,
  })

  // Clock — tick every second
  useEffect(() => {
    const tick = () => {
      const now = new Date()
      setState(s => ({
        ...s,
        time: now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        date: now.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(),
      }))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  // Fetch WHOOP + alerts once on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/whoop/today').then(r => r.ok ? r.json() : null).catch(() => null),
      fetch('/api/chat/alerts').then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([whoop, alerts]) => {
      setState(s => ({
        ...s,
        recovery: whoop?.recovery_score ?? null,
        recoveryRec: whoop?.recommendation ?? null,
        alertCount: Array.isArray(alerts) ? alerts.length : 0,
      }))
    })
  }, [])

  const recoveryColor =
    state.recoveryRec === 'green'  ? '#00cc6a'
    : state.recoveryRec === 'yellow' ? '#ffb300'
    : state.recoveryRec === 'red'    ? '#ff3535'
    : 'rgba(0,186,220,0.3)'

  return (
    <div
      style={{
        height: 28,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 16px',
        background: 'rgba(2, 8, 15, 0.98)',
        borderBottom: '1px solid rgba(0,186,220,0.08)',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        <span style={{
          color: 'rgba(0,186,220,0.4)',
          letterSpacing: '0.18em',
          fontSize: 9,
          fontFamily: 'var(--font-display)',
          fontWeight: 600,
        }}>
          EDEN OS
        </span>
        {DOT}
        <span style={{ color: '#316a86' }}>v1.0</span>
        {DOT}
        {/* Heartbeat indicator */}
        <span style={{
          display: 'inline-block',
          width: 5, height: 5,
          borderRadius: '50%',
          background: '#00cc6a',
          animation: 'pulse-dot 2.5s ease-in-out infinite',
          marginRight: 5,
        }} />
        <span style={{ color: '#163d55', fontSize: 9 }}>ONLINE</span>
      </div>

      {/* Center — time + date */}
      <div style={{ display: 'flex', alignItems: 'center', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>
        <span style={{
          color: '#00badc',
          letterSpacing: '0.12em',
          fontSize: 11,
          textShadow: '0 0 12px rgba(0,186,220,0.4)',
        }}>
          {state.time}
        </span>
        {DOT}
        <span style={{ color: '#316a86', letterSpacing: '0.1em' }}>
          {state.date}
        </span>
      </div>

      {/* Right — biometrics + alerts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
        {state.recovery != null && (
          <>
            <span style={{ color: '#163d55', fontSize: 9, letterSpacing: '0.12em' }}>RECOVERY</span>
            <span style={{ color: recoveryColor, marginLeft: 4, fontSize: 10 }}>
              {state.recovery}%
            </span>
            {DOT}
          </>
        )}
        {state.alertCount > 0 && (
          <>
            <span style={{ color: '#ffb300' }}>
              {state.alertCount} ALERT{state.alertCount !== 1 ? 'S' : ''}
            </span>
            {DOT}
          </>
        )}
        {/* Right-edge bracket */}
        <span style={{ color: 'rgba(0,186,220,0.2)', fontSize: 9, marginLeft: 2 }}>
          ◢
        </span>
      </div>
    </div>
  )
}
