import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'

interface Alert {
  type: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  message: string
}

// Map alert types to the routes they belong to
const ALERT_DOMAIN: Record<string, string[]> = {
  past_deadline:       ['/today', '/week'],
  due_soon:            ['/today', '/week'],
  deferred_task:       ['/today'],
  thin_goal:           ['/goals', '/lifemap'],
  low_recovery:        ['/health'],
  strain_recovery_conflict: ['/health'],
  recovery_trend:      ['/health'],
  stale_contact:       ['/people'],
  overdue_commitment:  ['/people'],
}

const SEVERITY_ORDER = { critical: 4, high: 3, medium: 2, low: 1 }

function worstSeverity(alerts: Alert[], path: string): 'critical' | 'high' | 'medium' | null {
  const relevant = alerts.filter(a => (ALERT_DOMAIN[a.type] ?? []).includes(path))
  if (!relevant.length) return null
  const worst = relevant.reduce((best, a) =>
    (SEVERITY_ORDER[a.severity] ?? 0) > (SEVERITY_ORDER[best.severity] ?? 0) ? a : best
  )
  return worst.severity === 'low' ? null : worst.severity as 'critical' | 'high' | 'medium'
}

const SEVERITY_DOT: Record<string, string> = {
  critical: '#c0392b',
  high:     '#e67e22',
  medium:   '#5fa8c8',
}

const NAV = [
  { path: '/',         label: 'Home',     glyph: '⌂', end: true  },
  { path: '/today',    label: 'Today',    glyph: '▦', end: false },
  { path: '/week',     label: 'Week',     glyph: '▤', end: false },
  { path: '/month',    label: 'Month',    glyph: '▥', end: false },
  { path: '/lifemap',  label: 'Life Map', glyph: '⬡', end: false },
  { path: '/goals',    label: 'Goals',    glyph: '◈', end: false },
  { path: '/projects', label: 'Projects', glyph: '◧', end: false },
  { path: '/health',   label: 'Health',   glyph: '◬', end: false },
  { path: '/people',   label: 'People',   glyph: '◉', end: false },
  { path: '/jarvis',   label: 'Eden',     glyph: '◎', end: false },
  { path: '/settings', label: 'Settings', glyph: '⚙', end: false },
]

export default function NavSidebar() {
  const { data: alerts = [] } = useQuery<Alert[]>({
    queryKey: ['alerts'],
    queryFn: async () => {
      const res = await fetch('/api/chat/alerts')
      if (!res.ok) return []
      return res.json()
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  return (
    <aside
      style={{
        width: 52,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 12,
        paddingBottom: 16,
        gap: 2,
        background: 'rgba(2, 8, 15, 0.98)',
        borderRight: '1px solid rgba(0,186,220,0.06)',
        position: 'relative',
        zIndex: 5,
      }}
    >
      {/* Corner accent — top */}
      <div style={{
        position: 'absolute',
        top: 0, left: 0,
        width: 8, height: 8,
        borderTop: '1px solid rgba(0,186,220,0.4)',
        borderLeft: '1px solid rgba(0,186,220,0.4)',
      }} />

      {/* Brand mark */}
      <img
        src="/favicon.svg"
        alt="Eden"
        width={28}
        height={28}
        style={{ marginBottom: 14, flexShrink: 0, borderRadius: 2 }}
      />

      {/* Divider */}
      <div style={{
        width: 20, height: 1,
        background: 'linear-gradient(to right, transparent, rgba(0,186,220,0.2), transparent)',
        marginBottom: 8,
        flexShrink: 0,
      }} />

      {/* Nav items */}
      {NAV.map(({ path, label, glyph, end }) => {
        const severity = worstSeverity(alerts, path)
        return (
          <NavLink
            key={path}
            to={path}
            end={end}
            title={label}
            className="relative group"
            style={({ isActive }) => ({
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 2,
              position: 'relative',
              fontSize: 15,
              color: isActive ? '#00badc' : '#316a86',
              background: isActive ? 'rgba(0,186,220,0.06)' : 'transparent',
              transition: 'color 0.15s, background 0.15s',
              textDecoration: 'none',
              textShadow: isActive ? '0 0 10px rgba(0,186,220,0.5)' : 'none',
            })}
          >
            {({ isActive }) => (
              <>
                {/* Active left accent bar */}
                {isActive && (
                  <span style={{
                    position: 'absolute',
                    left: -1,
                    top: '25%', bottom: '25%',
                    width: 2,
                    background: '#00badc',
                    borderRadius: 1,
                    boxShadow: '0 0 6px rgba(0,186,220,0.6)',
                  }} />
                )}

                {/* Active corner brackets */}
                {isActive && (
                  <>
                    <span style={{
                      position: 'absolute', top: 2, left: 2,
                      width: 5, height: 5,
                      borderTop: '1px solid rgba(0,186,220,0.5)',
                      borderLeft: '1px solid rgba(0,186,220,0.5)',
                    }} />
                    <span style={{
                      position: 'absolute', bottom: 2, right: 2,
                      width: 5, height: 5,
                      borderBottom: '1px solid rgba(0,186,220,0.5)',
                      borderRight: '1px solid rgba(0,186,220,0.5)',
                    }} />
                  </>
                )}

                {glyph}

                {/* Health indicator dot */}
                {severity && (
                  <span style={{
                    position: 'absolute',
                    top: 4, right: 4,
                    width: 5, height: 5,
                    borderRadius: '50%',
                    background: SEVERITY_DOT[severity],
                    boxShadow: `0 0 5px ${SEVERITY_DOT[severity]}`,
                  }} />
                )}

                {/* Tooltip */}
                <span
                  style={{
                    position: 'absolute',
                    left: 44,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    padding: '4px 8px',
                    borderRadius: 2,
                    fontSize: 10,
                    whiteSpace: 'nowrap',
                    pointerEvents: 'none',
                    opacity: 0,
                    transition: 'opacity 0.15s',
                    background: '#050f1e',
                    color: '#5fa8c8',
                    border: '1px solid rgba(0,186,220,0.15)',
                    fontFamily: 'var(--font-display)',
                    fontWeight: 500,
                    letterSpacing: '0.1em',
                    zIndex: 50,
                  }}
                  className="group-hover:opacity-100"
                >
                  {label.toUpperCase()}
                </span>
              </>
            )}
          </NavLink>
        )
      })}

      {/* Corner accent — bottom */}
      <div style={{
        position: 'absolute',
        bottom: 0, right: 0,
        width: 8, height: 8,
        borderBottom: '1px solid rgba(0,186,220,0.4)',
        borderRight: '1px solid rgba(0,186,220,0.4)',
      }} />
    </aside>
  )
}
