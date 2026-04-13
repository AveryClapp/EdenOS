import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSchedule, runScheduler, planDay, getExplanation, getGoalProposals } from '../api/schedule'
import { listTasks, completeTask } from '../api/tasks'
import { getNowSuggestion } from '../api/now'
import { executeActions } from '../api/chat'
import AlertStrip from '../components/AlertStrip'
import TimeGrid from '../components/TimeGrid'
import type { Task, PlanDayResult, ScheduleExplanation } from '../types'

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase()
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatElapsed(secs: number): string {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

const BTN_PRIMARY: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.1em',
  color: '#00badc',
  background: 'rgba(0,186,220,0.08)',
  border: '1px solid rgba(0,186,220,0.25)',
  borderRadius: 2,
  padding: '4px 10px',
  cursor: 'pointer',
  transition: 'all 0.15s',
}

const BTN_GHOST: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  letterSpacing: '0.08em',
  color: '#316a86',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '4px 6px',
}

function CompleteForm({
  task,
  defaultMins,
  onDone,
}: {
  task: Task
  defaultMins?: number
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [mins, setMins] = useState(String(defaultMins ?? task.estimated_minutes))
  const [quality, setQuality] = useState('3')
  const [energy, setEnergy] = useState('3')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      completeTask(task.id, {
        actual_minutes: Number(mins),
        completion_quality: Number(quality),
        energy_level_at_start: Number(energy),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  const fieldStyle: React.CSSProperties = {
    width: 44,
    fontSize: 11,
    fontFamily: 'var(--font-mono)',
    padding: '3px 6px',
    background: 'rgba(0,186,220,0.04)',
    border: '1px solid rgba(0,186,220,0.12)',
    borderRadius: 2,
    color: '#9dd4ea',
    outline: 'none',
  }

  return (
    <div style={{ padding: '8px 20px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid rgba(0,186,220,0.06)', background: 'rgba(0,186,220,0.02)' }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>MINS</span>
      <input style={fieldStyle} value={mins} onChange={e => setMins(e.target.value)} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>QUALITY</span>
      <input style={{ ...fieldStyle, width: 36 }} value={quality} onChange={e => setQuality(e.target.value)} type="number" min={1} max={5} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>ENERGY</span>
      <input style={{ ...fieldStyle, width: 36 }} value={energy} onChange={e => setEnergy(e.target.value)} type="number" min={1} max={5} />
      <button onClick={() => mutate()} disabled={isPending} style={{ ...BTN_PRIMARY, opacity: isPending ? 0.5 : 1 }}>
        {isPending ? '···' : 'DONE'}
      </button>
      <button onClick={onDone} style={BTN_GHOST}>CANCEL</button>
      {error && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#ff3535' }}>{error}</span>}
    </div>
  )
}

function NowStrip() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['now'],
    queryFn: getNowSuggestion,
    refetchInterval: 60_000,
  })

  const [skips, setSkips] = useState(0)
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null)
  const [timerStart, setTimerStart] = useState<number | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [showLog, setShowLog] = useState(false)

  useEffect(() => {
    if (!timerStart) return
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - timerStart) / 1000)), 1000)
    return () => clearInterval(id)
  }, [timerStart])

  const now = Date.now()
  const isSnoozed = snoozedUntil !== null && now < snoozedUntil
  if (isLoading || isSnoozed || !data?.task) return null

  const handleOnIt = () => { setTimerStart(Date.now()); setElapsed(0) }
  const handleSkip = () => { setSkips(s => s + 1); setTimerStart(null); qc.invalidateQueries({ queryKey: ['now'] }) }
  const handleNotNow = () => { setTimerStart(null); setSnoozedUntil(Date.now() + 20 * 60 * 1000) }
  const elapsedMins = Math.max(1, Math.ceil(elapsed / 60))

  const stripStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 20px',
    borderBottom: '1px solid rgba(0,186,220,0.08)',
    background: 'rgba(0,186,220,0.03)',
    borderLeft: '2px solid rgba(0,186,220,0.5)',
  }

  if (timerStart) {
    return (
      <div>
        <div style={stripStyle}>
          <button onClick={() => setShowLog(true)} style={BTN_PRIMARY}>STOP</button>
          <span style={{ flex: 1, fontSize: 12, fontWeight: 300, color: '#9dd4ea', fontFamily: 'var(--font-sans)' }} className="truncate">
            {data.task.title}
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#00badc', flexShrink: 0 }}>
            {formatElapsed(elapsed)}
          </span>
          <button onClick={handleSkip} style={BTN_GHOST}>ABANDON</button>
        </div>
        {showLog && (
          <CompleteForm
            task={data.task as Task}
            defaultMins={elapsedMins}
            onDone={() => {
              setTimerStart(null); setElapsed(0); setShowLog(false)
              qc.invalidateQueries({ queryKey: ['now'] })
              qc.invalidateQueries({ queryKey: ['tasks'] })
              qc.invalidateQueries({ queryKey: ['schedule'] })
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div style={stripStyle}>
      <button onClick={handleOnIt} style={BTN_PRIMARY}>ON IT</button>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 300, color: '#9dd4ea' }}>{data.task.title}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86' }}>{' '}—{' '}{data.reason}</span>
      </span>
      <button onClick={handleSkip} style={BTN_GHOST}>SKIP</button>
      <button onClick={handleNotNow} style={BTN_GHOST}>NOT NOW</button>
      {skips >= 3 && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#ffb300', letterSpacing: '0.08em' }}>
          DAY DRIFTING
        </span>
      )}
    </div>
  )
}

function ProposalsStrip({ proposals, onAdd }: {
  proposals: Array<{ title: string; cognitive_load: number; estimated_minutes: number; project_id: string }>
  onAdd: (p: { title: string; cognitive_load: number; estimated_minutes: number; project_id: string }) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid rgba(0,186,220,0.06)' }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 20px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>SUGGESTED TASKS ({proposals.length})</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {proposals.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 12, fontWeight: 300, color: '#9dd4ea' }}>{p.title}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86' }}>{p.estimated_minutes}m</span>
              <button onClick={() => onAdd(p)} style={BTN_PRIMARY}>ADD</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function WhyStrip({ explanation }: { explanation: ScheduleExplanation }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ borderBottom: '1px solid rgba(0,186,220,0.06)' }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '7px 20px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>WHY THIS SCHEDULE</span>
      </button>
      {open && (
        <div style={{ padding: '0 20px 10px', fontSize: 12, fontWeight: 300, color: '#5fa8c8', lineHeight: 1.6 }}>
          {explanation.summary}
        </div>
      )}
    </div>
  )
}

export default function Today() {
  const qc = useQueryClient()
  const [intent, setIntent] = useState('')
  const [planResult, setPlanResult] = useState<PlanDayResult | null>(null)

  const { data: schedule } = useQuery({
    queryKey: ['schedule'],
    queryFn: () => getSchedule(),
    refetchInterval: 60_000,
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
  })

  const { data: explanation } = useQuery({
    queryKey: ['schedule-explanation'],
    queryFn: getExplanation,
    refetchInterval: 60_000,
  })

  const { data: proposals } = useQuery({
    queryKey: ['goal-proposals'],
    queryFn: getGoalProposals,
    refetchInterval: 60_000,
  })

  const { mutate: addProposal } = useMutation({
    mutationFn: (p: { title: string; cognitive_load: number; estimated_minutes: number; project_id: string }) =>
      executeActions([{ approved: true, name: 'create_task', tool_use_id: '', input: { project_id: p.project_id, title: p.title, cognitive_load: p.cognitive_load, estimated_minutes: p.estimated_minutes } }]),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['goal-proposals'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })

  const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]))

  const { mutate: runSched, isPending: running } = useMutation({
    mutationFn: runScheduler,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule'] }),
  })

  const { mutate: plan, isPending: planning } = useMutation({
    mutationFn: () => planDay(intent.trim()),
    onSuccess: (data) => {
      setPlanResult(data)
      setIntent('')
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set())

  const allTodayBlocks = schedule?.today ?? []
  const todayBlocks = allTodayBlocks.filter(b => {
    const src = b.cal_source ?? 'eden'
    return !hiddenSources.has(src)
  })

  const calSources = Array.from(new Set(allTodayBlocks.map(b => b.cal_source ?? 'eden')))

  function toggleSource(src: string) {
    setHiddenSources(prev => {
      const next = new Set(prev)
      if (next.has(src)) next.delete(src)
      else next.add(src)
      return next
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <NowStrip />

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 20px 10px', borderBottom: '1px solid rgba(0,186,220,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 26, letterSpacing: '0.08em', color: '#cde8f5', margin: 0 }}>
            {formatDate(new Date())}
          </h1>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>
            {todayBlocks.length} BLOCKS
          </span>
        </div>
        <button onClick={() => runSched()} disabled={running} style={{ ...BTN_GHOST, opacity: running ? 0.5 : 1, letterSpacing: '0.08em' }}>
          {running ? 'RUNNING···' : 'RE-RUN SCHEDULER'}
        </button>
      </div>

      {/* Calendar source filter */}
      {calSources.length > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 20px', borderBottom: '1px solid rgba(0,186,220,0.05)', flexShrink: 0 }}>
          {calSources.map(src => {
            const active = !hiddenSources.has(src)
            const srcLabels: Record<string, string> = { gcal: 'GCAL', outlook: 'OUTLOOK', eden: 'EDEN' }
            return (
              <button key={src} onClick={() => toggleSource(src)} style={{
                fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em',
                color: active ? '#00badc' : '#1e4d6b',
                background: active ? 'rgba(0,186,220,0.08)' : 'transparent',
                border: `1px solid ${active ? 'rgba(0,186,220,0.25)' : 'rgba(0,186,220,0.06)'}`,
                borderRadius: 2, padding: '2px 7px', cursor: 'pointer', transition: 'all 0.15s',
              }}>
                {srcLabels[src] ?? src.toUpperCase()}
              </button>
            )
          })}
        </div>
      )}

      {/* Intent input */}
      <div style={{ padding: '10px 20px', borderBottom: '1px solid rgba(0,186,220,0.06)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0,186,220,0.03)', border: '1px solid rgba(0,186,220,0.1)', borderRadius: 2, padding: '7px 10px' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(0,186,220,0.35)', flexShrink: 0 }}>&gt;</span>
          <input
            style={{ flex: 1, background: 'transparent', outline: 'none', border: 'none', fontSize: 12, fontWeight: 300, color: '#9dd4ea', caretColor: '#00badc', fontFamily: 'var(--font-sans)' }}
            placeholder="What do you want to work on today?"
            value={intent}
            onChange={e => setIntent(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && intent.trim() && !planning) plan() }}
            disabled={planning}
          />
          <button
            onClick={() => plan()}
            disabled={planning || !intent.trim()}
            style={{ ...BTN_PRIMARY, opacity: planning || !intent.trim() ? 0.4 : 1 }}
          >
            {planning ? 'PLANNING···' : 'PLAN'}
          </button>
        </div>
        {planResult && (
          <div style={{ marginTop: 6 }}>
            <p style={{ fontFamily: 'var(--font-sans)', fontSize: 11, fontWeight: 300, color: '#5fa8c8', margin: '0 0 2px' }}>{planResult.summary}</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.08em', margin: 0 }}>
              {[
                planResult.created_projects > 0 && `${planResult.created_projects} PROJECT${planResult.created_projects !== 1 ? 'S' : ''} CREATED`,
                planResult.created_tasks > 0 && `${planResult.created_tasks} TASK${planResult.created_tasks !== 1 ? 'S' : ''} ADDED`,
                `${planResult.blocks_created} BLOCK${planResult.blocks_created !== 1 ? 'S' : ''} SCHEDULED`,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
      </div>

      {/* Alerts */}
      <AlertStrip />

      {/* Time grid */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {(proposals?.proposals?.length ?? 0) > 0 && (
          <ProposalsStrip proposals={proposals!.proposals} onAdd={addProposal} />
        )}
        {explanation?.summary && <WhyStrip explanation={explanation} />}
        <div style={{ paddingTop: 4 }}>
          {todayBlocks.length === 0 && (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#1e4d6b', letterSpacing: '0.1em', padding: '14px 20px' }}>
              NO BLOCKS SCHEDULED — DESCRIBE YOUR DAY ABOVE TO LET EDEN PLAN IT
            </p>
          )}
          <TimeGrid blocks={todayBlocks} taskMap={taskMap} date={todayStr()} />
        </div>
      </div>
    </div>
  )
}
