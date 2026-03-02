import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getEnergyProfile, setEnergyProfile } from '../api/energy_profile'
import { listAvailability, createAvailability, deleteAvailability } from '../api/availability'
import { syncGitHub } from '../api/github'
import { listProjects } from '../api/projects'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const ENERGY_COLORS = [
  '',
  'text-red-500',
  'text-orange-400',
  'text-yellow-400',
  'text-lime-400',
  'text-emerald-400',
]

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
      </div>
    </div>
  )
}
