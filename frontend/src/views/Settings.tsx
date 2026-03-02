import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEnergyProfile, setEnergyProfile } from '../api/energy_profile'
import { getUserProfile, updateUserProfile, getEnergyDefaults } from '../api/user_profile'
import type { UserProfile } from '../types'
import { listAvailability, createAvailability, deleteAvailability } from '../api/availability'
import { syncGitHub } from '../api/github'
import { listProjects } from '../api/projects'
import { getWhoopStatus, syncWhoop, connectWhoop } from '../api/whoop'
import type { WhoopStatus, UserMemory } from '../types'
import { listMemory, createMemory, deleteMemory } from '../api/memory'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const ENERGY_COLORS = [
  '',
  'text-red-500',
  'text-orange-400',
  'text-yellow-400',
  'text-lime-400',
  'text-emerald-400',
]

// ─── Whoop ────────────────────────────────────────────────────────────────────

const RECOVERY_COLORS: Record<string, string> = {
  green: 'text-emerald-400',
  yellow: 'text-yellow-400',
  red: 'text-red-400',
}

function WhoopSection() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['whoop-status'],
    queryFn: getWhoopStatus,
    refetchInterval: 5 * 60_000,  // refresh every 5 min
  })

  const { mutate: sync, isPending: syncing } = useMutation({
    mutationFn: syncWhoop,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['whoop-status'] }),
  })

  if (isLoading) return <div className="text-zinc-600 text-xs">loading...</div>

  if (!status?.connected) {
    return (
      <div className="space-y-2">
        <p className="text-zinc-600 text-xs">
          Connect Whoop to automatically adjust your energy profile based on daily recovery score.
          Requires <code className="text-zinc-400">WHOOP_CLIENT_ID</code> and{' '}
          <code className="text-zinc-400">WHOOP_CLIENT_SECRET</code> in your{' '}
          <code className="text-zinc-400">.env</code>.
        </p>
        <button
          onClick={connectWhoop}
          className="text-xs text-emerald-400 hover:text-emerald-300 border border-zinc-700 px-2 py-0.5 transition-colors"
        >
          [ connect whoop ]
        </button>
      </div>
    )
  }

  const today = status.today
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className="text-emerald-600 text-xs">● connected</span>
        <button
          onClick={() => sync()}
          disabled={syncing}
          className="text-xs text-zinc-600 hover:text-zinc-400 disabled:text-zinc-800 transition-colors"
        >
          {syncing ? 'syncing...' : '[ sync now ]'}
        </button>
      </div>

      {today ? (
        <div className="grid grid-cols-3 gap-x-6 gap-y-1 text-xs">
          <div>
            <span className="text-zinc-600">recovery </span>
            <span className={today.recommendation ? RECOVERY_COLORS[today.recommendation] : 'text-zinc-400'}>
              {today.recovery_score ?? '—'}%
            </span>
          </div>
          <div>
            <span className="text-zinc-600">hrv </span>
            <span className="text-zinc-300">{today.hrv_rms?.toFixed(1) ?? '—'}</span>
          </div>
          <div>
            <span className="text-zinc-600">rhr </span>
            <span className="text-zinc-300">{today.resting_hr ?? '—'}</span>
          </div>
          <div>
            <span className="text-zinc-600">strain </span>
            <span className="text-zinc-300">{today.strain_score?.toFixed(1) ?? '—'}</span>
          </div>
          <div>
            <span className="text-zinc-600">sleep </span>
            <span className="text-zinc-300">{today.sleep_quality_score ?? '—'}%</span>
          </div>
          <div>
            <span className="text-zinc-600">woke </span>
            <span className="text-zinc-300">{today.actual_wake_time ?? '—'}</span>
          </div>
        </div>
      ) : (
        <p className="text-zinc-700 text-xs">no data for today — sync to fetch</p>
      )}
    </div>
  )
}

// ─── Chronotype ───────────────────────────────────────────────────────────────

const CHRONOTYPE_OPTIONS = [
  { value: 'early', label: 'Early bird', hint: 'Natural wake ~5–6am' },
  { value: 'intermediate', label: 'Intermediate', hint: 'Natural wake ~7–8am' },
  { value: 'late', label: 'Night owl', hint: 'Natural wake ~9–10am' },
] as const

function ChronotypeSection() {
  const qc = useQueryClient()
  const { data: profile } = useQuery({
    queryKey: ['user-profile'],
    queryFn: getUserProfile,
  })

  const [wakeHour, setWakeHour] = useState<number>(7)
  const [chronotype, setChronotype] = useState<string>('intermediate')
  const [saved, setSaved] = useState(false)
  const [applying, setApplying] = useState(false)

  useEffect(() => {
    if (profile) {
      setWakeHour(profile.wake_hour)
      setChronotype(profile.chronotype)
    }
  }, [profile])

  const { mutate: save, isPending: saving } = useMutation({
    mutationFn: () => updateUserProfile({ wake_hour: wakeHour, chronotype }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  const { mutate: applyDefaults } = useMutation({
    mutationFn: async () => {
      await updateUserProfile({ wake_hour: wakeHour, chronotype })
      const defaults = await getEnergyDefaults()
      return setEnergyProfile(defaults)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user-profile'] })
      qc.invalidateQueries({ queryKey: ['energy-profile'] })
      setApplying(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
    onMutate: () => setApplying(true),
  })

  const wakeTimeStr = `${String(wakeHour).padStart(2, '0')}:00`

  function handleWakeTimeChange(val: string) {
    const [h] = val.split(':').map(Number)
    if (!isNaN(h) && h >= 0 && h <= 23) setWakeHour(h)
  }

  return (
    <div className="space-y-4">
      <p className="text-zinc-600 text-xs">
        Eden schedules deep work (load=3) in your peak cognitive window — 2–4h after waking.
        Set your wake time and Eden pre-populates your energy profile with the science-based curve.
      </p>

      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-zinc-600 text-xs">Wake time</span>
          <input
            type="time"
            value={wakeTimeStr}
            onChange={(e) => handleWakeTimeChange(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs w-28"
          />
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-zinc-600 text-xs">Chronotype</span>
          <select
            value={chronotype}
            onChange={(e) => setChronotype(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs"
          >
            {CHRONOTYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label} — {o.hint}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => save()}
          disabled={saving || saved}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
        >
          {saving ? '...' : saved ? '[ saved ✓ ]' : '[ save ]'}
        </button>
        <button
          onClick={() => applyDefaults()}
          disabled={applying}
          className="text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-700 border border-zinc-700 disabled:border-zinc-800 px-2 py-0.5 transition-colors"
        >
          {applying ? 'applying...' : '[ apply to energy profile ]'}
        </button>
        <span className="text-zinc-700 text-xs">overwrites energy grid with science curve</span>
      </div>
    </div>
  )
}

// ─── Energy Profile ───────────────────────────────────────────────────────────

function EnergyGrid() {
  const qc = useQueryClient()
  const { data: profile = [] } = useQuery({
    queryKey: ['energy-profile'],
    queryFn: getEnergyProfile,
  })

  const [grid, setGrid] = useState<number[][]>(() =>
    Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 3)),
  )

  useEffect(() => {
    if (profile.length === 0) return
    const next = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 3))
    profile.forEach((e) => {
      next[e.day_of_week][e.hour_of_day] = e.energy_level
    })
    setGrid(next)
  }, [profile])

  const [saved, setSaved] = useState(false)

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => {
      const entries = []
      for (let d = 0; d < 7; d++) {
        for (let h = 0; h < 24; h++) {
          entries.push({ day_of_week: d, hour_of_day: h, energy_level: grid[d][h] })
        }
      }
      return setEnergyProfile(entries)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['energy-profile'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    },
  })

  function cycleCell(day: number, hour: number) {
    setGrid((prev) =>
      prev.map((row, d) =>
        d === day ? row.map((val, h) => (h === hour ? (val % 5) + 1 : val)) : row,
      ),
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-zinc-600 text-xs">Click cells to cycle 1–5 (1=low, 5=high energy)</span>
        <button
          onClick={() => save()}
          disabled={isPending || saved}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
        >
          {isPending ? '...' : saved ? '[ saved ✓ ]' : '[ save ]'}
        </button>
      </div>
      <div className="flex text-xs text-zinc-600 mb-0.5">
        <span className="w-8" />
        {DAYS.map((d) => (
          <span key={d} className="w-8 text-center">{d}</span>
        ))}
      </div>
      {Array.from({ length: 24 }, (_, h) => (
        <div key={h} className="flex items-center">
          <span className="text-zinc-700 text-xs w-8 shrink-0">
            {String(h).padStart(2, '0')}
          </span>
          {Array.from({ length: 7 }, (_, d) => (
            <button
              key={d}
              onClick={() => cycleCell(d, h)}
              className={`w-8 h-5 text-xs font-mono hover:bg-zinc-800 transition-colors ${ENERGY_COLORS[grid[d][h]]}`}
            >
              {grid[d][h]}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

// ─── Availability Windows ─────────────────────────────────────────────────────

function AvailabilitySection() {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('17:00')
  const [day, setDay] = useState<string>('')

  const { data: windows = [] } = useQuery({
    queryKey: ['availability'],
    queryFn: listAvailability,
  })

  const { mutate: add, isPending: addPending } = useMutation({
    mutationFn: () =>
      createAvailability({
        day_of_week: day === '' ? null : Number(day),
        start_time: start,
        end_time: end,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['availability'] })
      setAdding(false)
    },
  })

  const { mutate: del } = useMutation({
    mutationFn: deleteAvailability,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['availability'] }),
  })

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-zinc-600 text-xs">
          If none configured, defaults to 06:00–22:00 every day.
        </span>
        <button
          onClick={() => setAdding((v) => !v)}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          + add
        </button>
      </div>

      {adding && (
        <div className="flex items-center gap-2 text-xs mb-2 py-2 border-b border-zinc-800">
          <select
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          >
            <option value="">every day</option>
            {DAYS.map((d, i) => (
              <option key={i} value={i}>{d}</option>
            ))}
          </select>
          <input
            type="time"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          />
          <span className="text-zinc-600">–</span>
          <input
            type="time"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          />
          <button
            onClick={() => add()}
            disabled={addPending}
            className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
          >
            {addPending ? '...' : '[ add ]'}
          </button>
          <button
            onClick={() => setAdding(false)}
            className="text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            cancel
          </button>
        </div>
      )}

      {windows.length === 0 && !adding ? (
        <div className="text-zinc-700 text-xs py-2">no windows defined</div>
      ) : (
        windows.map((w) => (
          <div key={w.id} className="flex items-center gap-3 text-xs py-1.5 border-b border-zinc-900">
            <span className="text-zinc-500 w-12 shrink-0">
              {w.day_of_week !== null ? DAYS[w.day_of_week] : 'ALL'}
            </span>
            <span className="text-zinc-200">
              {w.start_time.slice(0, 5)} – {w.end_time.slice(0, 5)}
            </span>
            <span className={w.is_available ? 'text-emerald-600' : 'text-zinc-600'}>
              {w.is_available ? 'available' : 'blocked'}
            </span>
            {w.note && <span className="text-zinc-600 italic flex-1">{w.note}</span>}
            <button
              onClick={() => del(w.id)}
              className="text-zinc-700 hover:text-red-500 ml-auto transition-colors"
            >
              ×
            </button>
          </div>
        ))
      )}
    </div>
  )
}

// ─── GitHub Sync ──────────────────────────────────────────────────────────────

function GitHubSection() {
  const qc = useQueryClient()
  const [projectId, setProjectId] = useState('')
  const [result, setResult] = useState<{ imported: number; skipped: number } | null>(null)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  })

  const { mutate: sync, isPending } = useMutation({
    mutationFn: () => syncGitHub(projectId),
    onSuccess: (data) => {
      setResult(data)
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  const activeProjects = projects.filter((p) => p.status === 'active')

  return (
    <div>
      <p className="text-zinc-600 text-xs mb-2">
        Imports open issues assigned to you + PRs requesting your review. Set{' '}
        <code className="text-zinc-400">GITHUB_TOKEN</code> in your{' '}
        <code className="text-zinc-400">.env</code>.
      </p>
      <div className="flex items-center gap-2">
        <select
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs flex-1"
        >
          <option value="">select project to import into...</option>
          {activeProjects.map((p) => (
            <option key={p.id} value={p.id}>{p.title}</option>
          ))}
        </select>
        <button
          onClick={() => sync()}
          disabled={isPending || !projectId}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 border border-zinc-700 disabled:border-zinc-800 px-2 py-1 transition-colors"
        >
          {isPending ? 'syncing...' : '[ sync ]'}
        </button>
      </div>
      {result && (
        <p className="text-zinc-500 text-xs mt-1.5">
          {result.imported} imported, {result.skipped} already present
        </p>
      )}
    </div>
  )
}

// ─── Memory ───────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<UserMemory['category'], string> = {
  preference: 'preference',
  constraint: 'constraint',
  goal_context: 'goal context',
  personal: 'personal',
  signal: 'signal',
}

const CATEGORY_COLORS: Record<UserMemory['category'], string> = {
  preference: 'text-blue-400',
  constraint: 'text-yellow-400',
  goal_context: 'text-emerald-400',
  personal: 'text-purple-400',
  signal: 'text-red-400',
}

function MemorySection() {
  const qc = useQueryClient()
  const [newContent, setNewContent] = useState('')
  const [newCategory, setNewCategory] = useState<UserMemory['category']>('preference')
  const [adding, setAdding] = useState(false)

  const { data: memories = [], isLoading } = useQuery({
    queryKey: ['memory'],
    queryFn: listMemory,
  })

  const { mutate: add, isPending: saving } = useMutation({
    mutationFn: () => createMemory({ category: newCategory, content: newContent }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['memory'] })
      setNewContent('')
      setAdding(false)
    },
  })

  const { mutate: remove } = useMutation({
    mutationFn: deleteMemory,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['memory'] }),
  })

  if (isLoading) return <div className="text-zinc-700 text-xs">loading...</div>

  return (
    <div className="space-y-3">
      <p className="text-zinc-600 text-xs">
        Facts Eden has learned about you from conversations. Edit or remove anything incorrect.
      </p>

      {memories.length === 0 && (
        <p className="text-zinc-800 text-xs">No memories yet — Eden learns from your chat conversations.</p>
      )}

      <div className="space-y-1">
        {memories.map((m) => (
          <div key={m.id} className="flex items-start gap-2 text-xs py-1 border-b border-zinc-900">
            <span className={`shrink-0 w-24 ${CATEGORY_COLORS[m.category as UserMemory['category']] ?? 'text-zinc-500'}`}>
              {CATEGORY_LABELS[m.category as UserMemory['category']] ?? m.category}
            </span>
            <span className="flex-1 text-zinc-400">{m.content}</span>
            <button
              onClick={() => remove(m.id)}
              className="text-zinc-800 hover:text-red-600 shrink-0 transition-colors"
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      {adding ? (
        <div className="space-y-2">
          <select
            value={newCategory}
            onChange={e => setNewCategory(e.target.value as UserMemory['category'])}
            className="bg-zinc-900 border border-zinc-800 text-zinc-400 text-xs px-2 py-1 w-full outline-none"
          >
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <input
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-300 text-xs px-2 py-1 outline-none focus:border-zinc-600"
            placeholder="e.g. prefers not to schedule admin before 10am"
            value={newContent}
            onChange={e => setNewContent(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && newContent.trim() && add()}
          />
          <div className="flex gap-2">
            <button
              onClick={() => newContent.trim() && add()}
              disabled={saving || !newContent.trim()}
              className="text-xs text-emerald-500 hover:text-emerald-400 disabled:text-zinc-800 transition-colors"
            >
              [ save ]
            </button>
            <button
              onClick={() => setAdding(false)}
              className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
            >
              [ cancel ]
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
        >
          [ + add manually ]
        </button>
      )}
    </div>
  )
}

// ─── Autonomy ─────────────────────────────────────────────────────────────────

const AUTONOMY_LABELS: Record<number, string> = {
  1: '1 — Full AI (auto-schedules, auto-locks)',
  2: '2 — AI with light review (default)',
  3: '3 — Collaborative (you must lock in)',
  4: '4 — User-led (AI fills gaps only)',
  5: '5 — Manual (AI responds when asked)',
}

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
    <div className="space-y-2">
      <p className="text-zinc-600 text-xs">
        Controls how proactively Eden schedules and nudges. Change any time.
      </p>
      <div className="space-y-1">
        {Object.entries(AUTONOMY_LABELS).map(([k, label]) => (
          <button
            key={k}
            onClick={() => save(Number(k))}
            className={`block w-full text-left text-xs py-1.5 px-2 transition-colors ${
              profile?.autonomy_level === Number(k)
                ? 'text-zinc-200 bg-zinc-800'
                : 'text-zinc-600 hover:text-zinc-400'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ─── Settings View ────────────────────────────────────────────────────────────

export default function Settings() {
  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-zinc-800 text-sm tracking-widest text-zinc-100 shrink-0">
        SETTINGS
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-10">
        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Whoop
          </h2>
          <WhoopSection />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Chronotype
          </h2>
          <ChronotypeSection />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Energy Profile
          </h2>
          <EnergyGrid />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Availability
          </h2>
          <AvailabilitySection />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Integrations
          </h2>
          <GitHubSection />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Autonomy
          </h2>
          <AutonomySection />
        </section>

        <section>
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase mb-3 pb-1 border-b border-zinc-800">
            Memory
          </h2>
          <MemorySection />
        </section>
      </div>
    </div>
  )
}
