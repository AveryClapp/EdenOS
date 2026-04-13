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
  return d.toLocaleDateString('en-US', { weekday: 'long', day: 'numeric', month: 'long' })
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

  return (
    <div className="pl-20 pr-6 py-2.5 flex items-center gap-3 text-xs border-b" style={{ background: '#111113', borderColor: '#27272a' }}>
      <span style={{ color: '#71717a' }}>mins</span>
      <input
        className="w-14 text-xs px-2 py-1 border"
        style={{ background: '#18181b', borderColor: '#27272a', color: '#f4f4f5', borderRadius: '6px' }}
        value={mins}
        onChange={(e) => setMins(e.target.value)}
      />
      <span style={{ color: '#71717a' }}>quality</span>
      <input
        className="w-10 text-xs px-2 py-1 border"
        style={{ background: '#18181b', borderColor: '#27272a', color: '#f4f4f5', borderRadius: '6px' }}
        value={quality}
        onChange={(e) => setQuality(e.target.value)}
        type="number" min={1} max={5}
      />
      <span style={{ color: '#71717a' }}>energy</span>
      <input
        className="w-10 text-xs px-2 py-1 border"
        style={{ background: '#18181b', borderColor: '#27272a', color: '#f4f4f5', borderRadius: '6px' }}
        value={energy}
        onChange={(e) => setEnergy(e.target.value)}
        type="number" min={1} max={5}
      />
      <button
        onClick={() => mutate()}
        disabled={isPending}
        className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
        style={{ background: isPending ? '#3f3f46' : '#7c2d12', color: isPending ? '#71717a' : '#fbbf24' }}
      >
        {isPending ? '…' : 'Done'}
      </button>
      <button onClick={onDone} className="text-xs transition-colors" style={{ color: '#71717a' }}
        onMouseEnter={e => (e.currentTarget.style.color = '#a1a1aa')}
        onMouseLeave={e => (e.currentTarget.style.color = '#71717a')}
      >
        Cancel
      </button>
      {error && <span className="text-red-500 text-xs ml-2">{error}</span>}
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

  if (isLoading || isSnoozed) return null
  if (!data?.task) return null

  const handleOnIt = () => {
    setTimerStart(Date.now())
    setElapsed(0)
  }

  const handleSkip = () => {
    setSkips(s => s + 1)
    setTimerStart(null)
    qc.invalidateQueries({ queryKey: ['now'] })
  }

  const handleNotNow = () => {
    setTimerStart(null)
    setSnoozedUntil(Date.now() + 20 * 60 * 1000)
  }

  const elapsedMins = Math.max(1, Math.ceil(elapsed / 60))

  if (timerStart) {
    return (
      <div className="border-b" style={{ borderColor: '#27272a' }}>
        <div className="px-6 py-3 flex items-center gap-4 text-xs" style={{ background: '#111113' }}>
          <button
            onClick={() => setShowLog(true)}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
            style={{ background: '#7c2d12', color: '#fbbf24' }}
          >
            Stop &amp; log
          </button>
          <span className="flex-1 truncate" style={{ color: '#e4e4e7' }}>{data.task.title}</span>
          <span className="font-mono shrink-0" style={{ color: '#fbbf24' }}>{formatElapsed(elapsed)}</span>
          <button onClick={handleSkip} className="text-xs shrink-0 transition-colors" style={{ color: '#71717a' }}>
            Abandon
          </button>
        </div>
        {showLog && (
          <CompleteForm
            task={data.task as Task}
            defaultMins={elapsedMins}
            onDone={() => {
              setTimerStart(null)
              setElapsed(0)
              setShowLog(false)
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
    <div className="px-6 py-3 flex items-center gap-4 text-xs border-b" style={{ background: '#111113', borderColor: '#27272a' }}>
      <button
        onClick={handleOnIt}
        className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
        style={{ background: '#7c2d12', color: '#fbbf24' }}
      >
        On it
      </button>
      <span className="flex-1 truncate">
        <span style={{ color: '#e4e4e7' }}>{data.task.title}</span>
        {' '}—{' '}
        <span style={{ color: '#71717a' }}>{data.reason}</span>
      </span>
      <button onClick={handleSkip} className="text-xs shrink-0 transition-colors" style={{ color: '#71717a' }}>Skip</button>
      <button onClick={handleNotNow} className="text-xs shrink-0 transition-colors" style={{ color: '#71717a' }}>Not now</button>
      {skips >= 3 && (
        <span className="text-xs shrink-0" style={{ color: '#d97706' }}>
          Day drifting — <a href="/plan" className="underline">replan?</a>
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
    <div style={{ borderBottom: '1px solid #27272a' }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 24px', background: 'none', border: 'none', cursor: 'pointer' }}>
        <span style={{ fontSize: 10, color: '#52525b' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 11, color: '#52525b' }}>Suggested tasks ({proposals.length})</span>
      </button>
      {open && (
        <div style={{ padding: '0 24px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {proposals.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <span style={{ color: '#e4e4e7', flex: 1 }}>{p.title}</span>
              <span style={{ color: '#71717a' }}>{p.estimated_minutes}m</span>
              <button onClick={() => onAdd(p)} style={{ fontSize: 11, color: '#fbbf24', background: 'none', border: '1px solid #27272a', borderRadius: 6, padding: '2px 8px', cursor: 'pointer' }}>Add</button>
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
    <div style={{ borderBottom: '1px solid #27272a' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 24px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 10, color: '#52525b' }}>{open ? '▾' : '▸'}</span>
        <span style={{ fontSize: 11, color: '#52525b' }}>Why this schedule?</span>
      </button>
      {open && (
        <div style={{ padding: '0 24px 12px', fontSize: 12, color: '#71717a', lineHeight: 1.6 }}>
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

  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]))

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

  const todayBlocks = schedule?.today ?? []

  return (
    <div className="flex flex-col h-full">
      <NowStrip />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b shrink-0" style={{ borderColor: '#27272a' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '22px', fontWeight: 300, color: '#f4f4f5', letterSpacing: '-0.02em' }}>
          {formatDate(new Date())}
        </span>
        <button
          onClick={() => runSched()}
          disabled={running}
          className="text-xs transition-colors"
          style={{ color: running ? '#3f3f46' : '#52525b' }}
        >
          {running ? 'Running…' : 'Re-run scheduler'}
        </button>
      </div>

      {/* Intent input */}
      <div className="px-6 py-3 border-b shrink-0" style={{ borderColor: '#27272a' }}>
        <div className="flex items-center gap-3">
          <input
            className="flex-1 text-sm outline-none placeholder:opacity-40 bg-transparent"
            style={{ color: '#e4e4e7' }}
            placeholder="What do you want to work on today?"
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && intent.trim() && !planning) plan() }}
            disabled={planning}
          />
          <button
            onClick={() => plan()}
            disabled={planning || !intent.trim()}
            className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors shrink-0"
            style={{ background: planning || !intent.trim() ? '#27272a' : '#7c2d12', color: planning || !intent.trim() ? '#52525b' : '#fbbf24' }}
          >
            {planning ? 'Planning…' : 'Plan'}
          </button>
        </div>
        {planResult && (
          <div className="mt-2 space-y-0.5">
            <p className="text-xs" style={{ color: '#71717a' }}>{planResult.summary}</p>
            <p className="text-xs" style={{ color: '#52525b' }}>
              {[
                planResult.created_projects > 0 && `${planResult.created_projects} project${planResult.created_projects !== 1 ? 's' : ''} created`,
                planResult.created_tasks > 0 && `${planResult.created_tasks} task${planResult.created_tasks !== 1 ? 's' : ''} added`,
                `${planResult.blocks_created} block${planResult.blocks_created !== 1 ? 's' : ''} scheduled`,
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
      </div>

      {/* Alerts */}
      <AlertStrip />

      {/* Time grid */}
      <div className="flex-1 overflow-y-auto">
        {(proposals?.proposals?.length ?? 0) > 0 && (
          <ProposalsStrip proposals={proposals!.proposals} onAdd={addProposal} />
        )}
        {explanation?.summary && (
          <WhyStrip explanation={explanation} />
        )}
        <div className="py-2">
          {todayBlocks.length === 0 && (
            <p className="px-6 pt-4 pb-2 text-xs" style={{ color: '#52525b' }}>
              Drag to block out time — or describe your day above to let Eden plan it.
            </p>
          )}
          <TimeGrid
            blocks={todayBlocks}
            taskMap={taskMap}
            date={todayStr()}
          />
        </div>
      </div>
    </div>
  )
}
