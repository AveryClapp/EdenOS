import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEnergyProfile, setEnergyProfile } from '../api/energy_profile'
import { getUserProfile, updateUserProfile, getEnergyDefaults } from '../api/user_profile'
import type { UserProfile } from '../types'
import { listAvailability, createAvailability, deleteAvailability } from '../api/availability'
import { getWhoopStatus, syncWhoop, connectWhoop } from '../api/whoop'
import type { WhoopStatus, UserMemory } from '../types'
import { listMemory, createMemory, deleteMemory } from '../api/memory'

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

// ─── Shared styles ────────────────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #27272a',
  borderRadius: 6,
  color: '#f4f4f5',
  fontSize: 12,
  padding: '4px 8px',
  outline: 'none',
}

const btnPrimary: React.CSSProperties = {
  background: '#7c2d12',
  color: '#fbbf24',
  border: 'none',
  borderRadius: 6,
  fontSize: 11,
  fontWeight: 500,
  padding: '4px 12px',
  cursor: 'pointer',
}

const btnGhost: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#71717a',
  fontSize: 11,
  cursor: 'pointer',
  padding: '4px 6px',
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      fontWeight: 600,
      letterSpacing: '0.1em',
      textTransform: 'uppercase',
      color: '#52525b',
      marginBottom: 12,
      paddingBottom: 6,
      borderBottom: '1px solid #27272a',
    }}>
      {children}
    </div>
  )
}

// ─── Schedule (chronotype + wake time) ────────────────────────────────────────

const CHRONOTYPE_OPTIONS = [
  { value: 'early', label: 'Early bird', hint: '~5–6am' },
  { value: 'intermediate', label: 'Intermediate', hint: '~7–8am' },
  { value: 'late', label: 'Night owl', hint: '~9–10am' },
] as const

function ScheduleSection() {
  const qc = useQueryClient()
  const { data: profile } = useQuery({ queryKey: ['user-profile'], queryFn: getUserProfile })

  const [wakeHour, setWakeHour] = useState(7)
  const [chronotype, setChronotype] = useState('intermediate')
  const [saved, setSaved] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (profile) { setWakeHour(profile.wake_hour); setChronotype(profile.chronotype) }
  }, [profile])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => updateUserProfile({ wake_hour: wakeHour, chronotype }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] })
      flash()
    },
  })

  const { mutate: applyDefaults } = useMutation({
    mutationFn: async () => {
      await updateUserProfile({ wake_hour: wakeHour, chronotype })
      return setEnergyProfile(await getEnergyDefaults())
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] })
      qc.invalidateQueries({ queryKey: ['energy-profile'] })
      setApplying(false)
      flash()
    },
    onMutate: () => setApplying(true),
  })

  function flash() { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  const wakeTimeStr = `${String(wakeHour).padStart(2, '0')}:00`

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        <div className="flex flex-col gap-1 flex-1">
          <span style={{ fontSize: 10, color: '#71717a' }}>Wake time</span>
          <input
            type="time"
            value={wakeTimeStr}
            onChange={e => { const [h] = e.target.value.split(':').map(Number); if (!isNaN(h)) setWakeHour(h) }}
            style={{ ...inputStyle, width: '100%' }}
          />
        </div>
        <div className="flex flex-col gap-1 flex-1">
          <span style={{ fontSize: 10, color: '#71717a' }}>Chronotype</span>
          <select
            value={chronotype}
            onChange={e => setChronotype(e.target.value)}
            style={{ ...inputStyle, width: '100%' }}
          >
            {CHRONOTYPE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label} {o.hint}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => save()} disabled={saving || saved} style={btnPrimary}>
          {saving ? '…' : saved ? 'Saved ✓' : 'Save'}
        </button>
        <button
          onClick={() => applyDefaults()}
          disabled={applying}
          style={{ ...btnGhost, color: applying ? '#3f3f46' : '#71717a' }}
          title="Overwrites energy profile with science-based curve for your chronotype"
        >
          {applying ? 'Applying…' : 'Apply energy defaults'}
        </button>
      </div>
    </div>
  )
}

// ─── Autonomy ─────────────────────────────────────────────────────────────────

const AUTONOMY_OPTS: [number, string, string][] = [
  [1, 'Full AI', 'auto-schedules and locks'],
  [2, 'Light review', 'AI plans, you approve (default)'],
  [3, 'Collaborative', 'you must lock each day in'],
  [4, 'User-led', 'AI fills gaps only'],
  [5, 'Manual', 'AI responds when asked'],
]

function AutonomySection() {
  const qc = useQueryClient()
  const { data: profile } = useQuery({ queryKey: ['user-profile'], queryFn: getUserProfile })

  const { mutate: save } = useMutation({
    mutationFn: (level: number) =>
      updateUserProfile({
        wake_hour: profile?.wake_hour ?? 7,
        chronotype: profile?.chronotype ?? 'intermediate',
        autonomy_level: level,
        planning_time: profile?.planning_time ?? '21:00',
        planning_auto_lock_minutes: profile?.planning_auto_lock_minutes ?? 60,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user-profile'] }),
  })

  return (
    <div className="space-y-1">
      {AUTONOMY_OPTS.map(([k, label, hint]) => {
        const active = profile?.autonomy_level === k
        return (
          <button
            key={k}
            onClick={() => save(k)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              width: '100%',
              textAlign: 'left',
              padding: '5px 8px',
              borderRadius: 6,
              background: active ? '#18181b' : 'transparent',
              border: active ? '1px solid #27272a' : '1px solid transparent',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontSize: 11, color: active ? '#fbbf24' : '#52525b', width: 14, flexShrink: 0 }}>
              {active ? '●' : '○'}
            </span>
            <span style={{ fontSize: 11, color: active ? '#e4e4e7' : '#71717a' }}>{label}</span>
            <span style={{ fontSize: 10, color: '#52525b', marginLeft: 2 }}>{hint}</span>
          </button>
        )
      })}
    </div>
  )
}

// ─── Availability ─────────────────────────────────────────────────────────────

function AvailabilitySection() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [day, setDay] = useState('')

  const { data: windows = [] } = useQuery({ queryKey: ['availability'], queryFn: listAvailability })

  const { mutate: add, isPending: addPending } = useMutation({
    mutationFn: () => createAvailability({ day_of_week: day === '' ? null : Number(day), start_time: start, end_time: end }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['availability'] }); setAdding(false) },
  })

  const { mutate: del } = useMutation({
    mutationFn: deleteAvailability,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['availability'] }),
  })

  return (
    <div className="space-y-2">
      {windows.length === 0 && !adding && (
        <p style={{ fontSize: 11, color: '#52525b' }}>Defaults to 6am–10pm every day.</p>
      )}
      {windows.map(w => (
        <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
          <span style={{ color: '#71717a', width: 30, flexShrink: 0 }}>
            {w.day_of_week !== null ? DAYS[w.day_of_week] : 'All'}
          </span>
          <span style={{ color: '#e4e4e7' }}>{w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}</span>
          <span style={{ color: w.is_available ? '#16a34a' : '#52525b' }}>
            {w.is_available ? 'available' : 'blocked'}
          </span>
          {w.note && <span style={{ color: '#52525b', flex: 1 }}>{w.note}</span>}
          <button onClick={() => del(w.id)} style={{ ...btnGhost, marginLeft: 'auto', color: '#52525b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#52525b')}
          >×</button>
        </div>
      ))}

      {adding ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <select value={day} onChange={e => setDay(e.target.value)} style={inputStyle}>
            <option value="">every day</option>
            {DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}
          </select>
          <input type="time" value={start} onChange={e => setStart(e.target.value)} style={inputStyle} />
          <span style={{ color: '#52525b', fontSize: 11 }}>–</span>
          <input type="time" value={end} onChange={e => setEnd(e.target.value)} style={inputStyle} />
          <button onClick={() => add()} disabled={addPending} style={btnPrimary}>{addPending ? '…' : 'Add'}</button>
          <button onClick={() => setAdding(false)} style={btnGhost}>Cancel</button>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...btnGhost, padding: 0, fontSize: 11 }}>
          + Add window
        </button>
      )}
    </div>
  )
}

// ─── Whoop ────────────────────────────────────────────────────────────────────

const RECOVERY_COLORS: Record<string, string> = {
  green: '#16a34a', yellow: '#d97706', red: '#dc2626',
}

function WhoopSection() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['whoop-status'],
    queryFn: getWhoopStatus,
    refetchInterval: 5 * 60_000,
  })
  const { mutate: sync, isPending: syncing } = useMutation({
    mutationFn: syncWhoop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whoop-status'] }),
  })

  if (isLoading) return <span style={{ fontSize: 11, color: '#52525b' }}>loading…</span>

  if (!status?.connected) {
    return (
      <div className="space-y-2">
        <p style={{ fontSize: 11, color: '#52525b' }}>
          Adjusts energy model from daily recovery score. Needs <code style={{ color: '#71717a' }}>WHOOP_CLIENT_ID</code> in .env.
        </p>
        <button onClick={connectWhoop} style={btnPrimary}>Connect Whoop</button>
      </div>
    )
  }

  const t = status.today
  return (
    <div className="space-y-2">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: '#16a34a' }}>● connected</span>
        <button onClick={() => sync()} disabled={syncing} style={btnGhost}>
          {syncing ? 'syncing…' : 'Sync now'}
        </button>
      </div>
      {t ? (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '4px 16px' }}>
          {[
            ['recovery', t.recovery_score != null ? `${t.recovery_score}%` : '—', t.recommendation ? RECOVERY_COLORS[t.recommendation] : '#71717a'],
            ['hrv', t.hrv_rms != null ? t.hrv_rms.toFixed(1) : '—', '#e4e4e7'],
            ['rhr', t.resting_hr ?? '—', '#e4e4e7'],
            ['strain', t.strain_score != null ? t.strain_score.toFixed(1) : '—', '#e4e4e7'],
            ['sleep', t.sleep_quality_score != null ? `${t.sleep_quality_score}%` : '—', '#e4e4e7'],
            ['wake', t.actual_wake_time ?? '—', '#e4e4e7'],
          ].map(([label, val, color]) => (
            <div key={label as string} style={{ fontSize: 11 }}>
              <span style={{ color: '#52525b' }}>{label} </span>
              <span style={{ color: color as string }}>{val as string}</span>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ fontSize: 11, color: '#52525b' }}>No data today — sync to fetch.</p>
      )}
    </div>
  )
}

// ─── Memory ───────────────────────────────────────────────────────────────────

const CAT_COLOR: Record<string, string> = {
  preference: '#60a5fa',
  constraint: '#d97706',
  goal_context: '#16a34a',
  personal: '#a78bfa',
  signal: '#dc2626',
}

function MemorySection() {
  const qc = useQueryClient()
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<UserMemory['category']>('preference')
  const [adding, setAdding] = useState(false)

  const { data: memories = [] } = useQuery({ queryKey: ['memory'], queryFn: listMemory })
  const { mutate: add, isPending: saving } = useMutation({
    mutationFn: () => createMemory({ category: newCategory, content: newContent }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['memory'] }); setNewContent(''); setAdding(false) },
  })
  const { mutate: remove } = useMutation({
    mutationFn: deleteMemory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory'] }),
  })

  return (
    <div className="space-y-2">
      {memories.length === 0 && !adding && (
        <p style={{ fontSize: 11, color: '#52525b' }}>None yet — Eden learns from your chat conversations.</p>
      )}
      {memories.map(m => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, paddingBottom: 6, borderBottom: '1px solid #27272a' }}>
          <span style={{ color: CAT_COLOR[m.category] ?? '#71717a', width: 80, flexShrink: 0, fontSize: 10 }}>
            {m.category}
          </span>
          <span style={{ color: '#a1a1aa', flex: 1, lineHeight: 1.5 }}>{m.content}</span>
          <button onClick={() => remove(m.id)} style={{ ...btnGhost, color: '#3f3f46', flexShrink: 0 }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#3f3f46')}
          >×</button>
        </div>
      ))}
      {adding ? (
        <div className="space-y-2">
          <div style={{ display: 'flex', gap: 6 }}>
            <select
              value={newCategory}
              onChange={e => setNewCategory(e.target.value as UserMemory['category'])}
              style={{ ...inputStyle, flexShrink: 0 }}
            >
              {Object.keys(CAT_COLOR).map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <input
              autoFocus
              style={{ ...inputStyle, flex: 1 }}
              placeholder="e.g. prefers not to schedule admin before 10am"
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && newContent.trim() && add()}
            />
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button onClick={() => newContent.trim() && add()} disabled={saving || !newContent.trim()} style={btnPrimary}>
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => setAdding(false)} style={btnGhost}>Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...btnGhost, padding: 0, fontSize: 11 }}>
          + Add manually
        </button>
      )}
    </div>
  )
}

// ─── Settings View ────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-6 py-5 border-b shrink-0" style={{ borderColor: '#27272a' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 300, color: '#f4f4f5', letterSpacing: '-0.02em' }}>
          Settings
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 2-column row: Schedule + Autonomy */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: '1px solid #27272a' }}>
          <div style={{ padding: '20px 24px', borderRight: '1px solid #27272a' }}>
            <SectionHeader>Schedule</SectionHeader>
            <ScheduleSection />
          </div>
          <div style={{ padding: '20px 24px' }}>
            <SectionHeader>Autonomy</SectionHeader>
            <AutonomySection />
          </div>
        </div>

        {/* 2-column row: Availability + Whoop */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, borderBottom: '1px solid #27272a' }}>
          <div style={{ padding: '20px 24px', borderRight: '1px solid #27272a' }}>
            <SectionHeader>Availability</SectionHeader>
            <AvailabilitySection />
          </div>
          <div style={{ padding: '20px 24px' }}>
            <SectionHeader>Whoop</SectionHeader>
            <WhoopSection />
          </div>
        </div>

        {/* Full-width: Memory */}
        <div style={{ padding: '20px 24px' }}>
          <SectionHeader>Memory</SectionHeader>
          <MemorySection />
        </div>
      </div>
    </div>
  )
}
