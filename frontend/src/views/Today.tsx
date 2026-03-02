import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getSchedule, runScheduler } from '../api/schedule'
import { listTasks, completeTask } from '../api/tasks'
import AlertStrip from '../components/AlertStrip'
import LoadDots from '../components/LoadDots'
import type { ScheduleBlock, Task } from '../types'

function formatDate(d: Date): string {
  return d
    .toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' })
    .toUpperCase()
}

function fmtTime(t: string): string {
  return t.slice(0, 5)
}

function CompleteForm({
  task,
  onDone,
}: {
  task: Task
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [mins, setMins] = useState(String(task.estimated_minutes))
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
    <div className="pl-20 pr-6 py-2 flex items-center gap-3 text-xs text-zinc-400 bg-zinc-900 border-b border-zinc-800">
      <span className="text-zinc-600">mins</span>
      <input
        className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-0.5 text-xs font-mono"
        value={mins}
        onChange={(e) => setMins(e.target.value)}
      />
      <span className="text-zinc-600">quality</span>
      <input
        className="w-8 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-0.5 text-xs font-mono"
        value={quality}
        onChange={(e) => setQuality(e.target.value)}
        type="number"
        min={1}
        max={5}
      />
      <span className="text-zinc-600">energy</span>
      <input
        className="w-8 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-0.5 text-xs font-mono"
        value={energy}
        onChange={(e) => setEnergy(e.target.value)}
        type="number"
        min={1}
        max={5}
      />
      <button
        onClick={() => mutate()}
        disabled={isPending}
        className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600 transition-colors"
      >
        {isPending ? '...' : '[ done ]'}
      </button>
      <button onClick={onDone} className="text-zinc-600 hover:text-zinc-400 transition-colors">
        cancel
      </button>
      {error && <span className="text-red-500 text-xs ml-2">[{error}]</span>}
    </div>
  )
}

function BlockRow({ block, task }: { block: ScheduleBlock; task?: Task }) {
  const [completing, setCompleting] = useState(false)
  const isDone = task?.status === 'done'
  const isLocked = block.overridden_by_user
  const isExternal = !block.task_id

  return (
    <div className="border-b border-zinc-900">
      <div
        className={
          'flex items-center px-6 py-2.5 gap-4 text-sm transition-colors ' +
          (isDone || isExternal ? 'cursor-default' : 'cursor-pointer hover:bg-zinc-900')
        }
        onClick={() => {
          if (task && !isDone) setCompleting((v) => !v)
        }}
      >
        <span className="text-zinc-500 w-11 shrink-0 text-xs">{fmtTime(block.start_time)}</span>
        <span className="text-zinc-800 mr-1">─</span>
        <span
          className={
            'flex-1 ' +
            (isDone
              ? 'line-through text-zinc-600'
              : isExternal
              ? 'text-zinc-600 italic'
              : 'text-zinc-100')
          }
        >
          {task
            ? task.title
            : block.calendar_event_id
            ? '[ external event ]'
            : '[ blocked ]'}
        </span>
        {task && <LoadDots level={task.cognitive_load} />}
        {isLocked && <span className="text-zinc-700 text-xs">[locked]</span>}
        {isDone && <span className="text-emerald-700 text-xs">[done]</span>}
        {task && !isDone && (
          <span className="text-zinc-700 text-xs opacity-0 group-hover:opacity-100">
            {completing ? '▾' : '▸'}
          </span>
        )}
      </div>
      {completing && task && (
        <CompleteForm task={task} onDone={() => setCompleting(false)} />
      )}
    </div>
  )
}

export default function Today() {
  const qc = useQueryClient()

  const { data: schedule } = useQuery({
    queryKey: ['schedule'],
    queryFn: () => getSchedule(),
    refetchInterval: 60_000,
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
  })

  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]))

  const { mutate: runSched, isPending: running } = useMutation({
    mutationFn: runScheduler,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['schedule'] }),
  })

  const todayBlocks = schedule?.today ?? []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-zinc-100 text-sm tracking-widest">{formatDate(new Date())}</span>
        <button
          onClick={() => runSched()}
          disabled={running}
          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2 py-0.5 transition-colors disabled:text-zinc-700 disabled:border-zinc-800"
        >
          {running ? 'running...' : 'run scheduler'}
        </button>
      </div>

      {/* Alerts */}
      <AlertStrip />

      {/* Timeline */}
      <div className="flex-1 overflow-y-auto">
        {todayBlocks.length === 0 ? (
          <div className="px-6 py-8 text-zinc-600 text-xs">
            no blocks scheduled — run the scheduler or add tasks.
          </div>
        ) : (
          todayBlocks.map((block) => (
            <BlockRow
              key={block.id}
              block={block}
              task={block.task_id ? taskMap[block.task_id] : undefined}
            />
          ))
        )}
      </div>
    </div>
  )
}
