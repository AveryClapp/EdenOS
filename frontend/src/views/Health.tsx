import { useQuery } from '@tanstack/react-query'

interface Observation {
  severity: 'high' | 'medium' | 'low'
  message: string
  type: string
}

interface HealthData {
  observations: Observation[]
  capacity: 'full' | 'reduced' | 'limited' | 'unknown'
  schedule_adapted: boolean
  blocks_today: number
  deep_blocks_today: number
}

const SEVERITY_STYLES: Record<string, { border: string; dot: string; text: string }> = {
  high:   { border: 'rgba(230,126,34,0.2)',  dot: '#e67e22', text: '#c8934a' },
  medium: { border: 'rgba(0,186,220,0.12)',  dot: '#5fa8c8', text: '#7ab0c8' },
  low:    { border: 'rgba(82,126,150,0.1)',  dot: '#2c526a', text: '#527e96' },
}

const CAPACITY_LABEL: Record<string, { label: string; color: string; sub: string }> = {
  full:    { label: 'Full capacity',    color: '#00cc6a', sub: 'Deep work scheduled at full weight.' },
  reduced: { label: 'Reduced capacity', color: '#e67e22', sub: 'Deep work load weighted down in today\'s schedule.' },
  limited: { label: 'Limited capacity', color: '#c0392b', sub: 'Load-3 tasks deprioritized. Light tasks only auto-scheduled.' },
  unknown: { label: 'No data',          color: '#2c526a', sub: 'Schedule running on energy profile defaults.' },
}

export default function Health() {
  const { data, isLoading } = useQuery<HealthData>({
    queryKey: ['health-observations'],
    queryFn: async () => {
      const res = await fetch('/api/health/observations')
      if (!res.ok) throw new Error('Failed to load')
      return res.json()
    },
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })

  const capacity = data ? CAPACITY_LABEL[data.capacity] : null

  return (
    <div style={{ padding: '24px 28px', maxWidth: 760, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <div style={{ width: 2, height: 14, background: 'linear-gradient(to bottom, #00badc, rgba(0,186,220,0.2))' }} />
          <h1 style={{
            fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
            letterSpacing: '0.18em', color: 'rgba(0,186,220,0.55)',
            textTransform: 'uppercase', margin: 0,
          }}>
            Health
          </h1>
        </div>
        <div style={{ fontSize: 11, color: '#527e96', fontWeight: 300, marginLeft: 12 }}>
          Cross-domain observations only — check WHOOP for raw metrics.
        </div>
      </div>

      {isLoading ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#2c526a', letterSpacing: '0.08em' }}>
          LOADING...
        </div>
      ) : !data ? (
        <div style={{ fontSize: 12, color: '#2c526a' }}>No data available.</div>
      ) : (
        <>
          {/* Capacity row */}
          {capacity && (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '14px 16px',
              marginBottom: 20,
              background: 'rgba(0,186,220,0.025)',
              border: '1px solid rgba(0,186,220,0.08)',
              borderRadius: 3,
            }}>
              <div style={{
                width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                background: capacity.color,
                boxShadow: `0 0 8px ${capacity.color}80`,
              }} />
              <div>
                <div style={{ fontSize: 13, fontWeight: 400, color: '#e4f2fa', marginBottom: 2 }}>
                  {capacity.label}
                </div>
                <div style={{ fontSize: 11, color: '#527e96', fontWeight: 300 }}>
                  {capacity.sub}
                </div>
              </div>
              {data.blocks_today > 0 && (
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#2c526a', letterSpacing: '0.06em' }}>
                    {data.blocks_today} block{data.blocks_today !== 1 ? 's' : ''} today
                  </div>
                  {data.deep_blocks_today > 0 && (
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'rgba(0,186,220,0.4)', letterSpacing: '0.06em' }}>
                      {data.deep_blocks_today} deep focus
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Observations */}
          {data.observations.length === 0 ? (
            <div style={{
              padding: '32px 0',
              textAlign: 'center',
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              letterSpacing: '0.1em',
              color: '#2c526a',
            }}>
              NO FLAGS — all systems nominal
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {data.observations.map((obs, i) => {
                const s = SEVERITY_STYLES[obs.severity] ?? SEVERITY_STYLES.low
                return (
                  <div key={i} style={{
                    padding: '12px 14px',
                    border: `1px solid ${s.border}`,
                    borderLeft: `2px solid ${s.dot}`,
                    borderRadius: '0 3px 3px 0',
                    background: 'rgba(0,186,220,0.015)',
                    display: 'flex',
                    gap: 12,
                    alignItems: 'flex-start',
                  }}>
                    <div style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: s.dot, flexShrink: 0, marginTop: 5,
                    }} />
                    <p style={{
                      margin: 0,
                      fontSize: 13,
                      fontWeight: 300,
                      lineHeight: 1.65,
                      color: s.text,
                    }}>
                      {obs.message}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )
}
