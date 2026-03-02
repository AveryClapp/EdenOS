import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listGoals, createGoal, updateGoal, deleteGoal } from '../api/goals'
import type { Goal } from '../types'

const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-400',
  paused: 'text-yellow-500',
  done: 'text-zinc-600',
  dropped: 'text-zinc-700',
}

const TIER_LABEL: Record<string, string> = {
  long: '6–24mo',
  mid: '2–8wk',
}

function GoalRow({
  goal,
  depth,
  children,
}: {
  goal: Goal
  depth: number
  children?: React.ReactNode
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(goal.title)

  const { mutate: patch } = useMutation({
    mutationFn: (body: Parameters<typeof updateGoal>[1]) => updateGoal(goal.id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      setEditing(false)
    },
  })

  const { mutate: remove, error: deleteError } = useMutation({
    mutationFn: () => deleteGoal(goal.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['goals'] }),
  })

  const isInactive = goal.status === 'done' || goal.status === 'dropped'

  return (
    <div>
      <div
        className="flex items-center gap-3 py-1.5 pr-6 text-sm border-b border-zinc-900 hover:bg-zinc-900 transition-colors group"
        style={{ paddingLeft: `${24 + depth * 20}px` }}
      >
        <span className={`text-xs w-14 shrink-0 ${STATUS_COLORS[goal.status] ?? 'text-zinc-500'}`}>
          [{goal.status}]
        </span>

        {editing ? (
          <input
            autoFocus
            className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-0.5 text-sm font-mono"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') patch({ title })
              if (e.key === 'Escape') setEditing(false)
            }}
            onBlur={() => setEditing(false)}
          />
        ) : (
          <span
            className={`flex-1 cursor-pointer ${isInactive ? 'text-zinc-600 line-through' : 'text-zinc-100'}`}
            onClick={() => setEditing(true)}
          >
            {goal.title}
          </span>
        )}

        <span className="text-zinc-600 text-xs shrink-0 w-14 text-right">
          {TIER_LABEL[goal.tier]}
        </span>
        <span className="text-zinc-600 text-xs shrink-0 w-20 text-right">{goal.target_date}</span>
        <span className="text-zinc-600 text-xs shrink-0 w-6 text-right">
          {goal.weight.toFixed(1)}
        </span>

        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs w-28 justify-end shrink-0">
          {goal.status === 'active' && (
            <>
              <button className="text-zinc-500 hover:text-zinc-300" onClick={() => patch({ status: 'done' })}>
                done
              </button>
              <button className="text-zinc-500 hover:text-zinc-300" onClick={() => patch({ status: 'paused' })}>
                pause
              </button>
            </>
          )}
          {goal.status === 'paused' && (
            <button className="text-zinc-500 hover:text-zinc-300" onClick={() => patch({ status: 'active' })}>
              resume
            </button>
          )}
          <button
            className="text-zinc-700 hover:text-red-500 transition-colors"
            onClick={() => { if (confirm(`Delete "${goal.title}"?`)) remove() }}
            title={deleteError ? (deleteError as Error).message : 'delete goal'}
          >
            del
          </button>
        </div>
      </div>
      {children}
    </div>
  )
}

function AddGoalForm({ goals, onDone }: { goals: Goal[]; onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [tier, setTier] = useState<'long' | 'mid'>('long')
  const [targetDate, setTargetDate] = useState('')
  const [weight, setWeight] = useState('0.8')
  const [parentId, setParentId] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createGoal({
        title,
        tier,
        target_date: targetDate,
        weight: Number(weight),
        parent_id: parentId || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['goals'] })
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  return (
    <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900 text-xs">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          autoFocus
          placeholder="goal title"
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs flex-1 min-w-48"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onDone()
          }}
        />
        <select
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={tier}
          onChange={(e) => setTier(e.target.value as 'long' | 'mid')}
        >
          <option value="long">long (6–24mo)</option>
          <option value="mid">mid (2–8wk)</option>
        </select>
        <select
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">no parent</option>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <input
          type="date"
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={targetDate}
          onChange={(e) => setTargetDate(e.target.value)}
        />
        <span className="text-zinc-500">weight</span>
        <input
          className="w-12 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={weight}
          onChange={(e) => setWeight(e.target.value)}
        />
        <button
          onClick={() => mutate()}
          disabled={isPending || !title || !targetDate}
          className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors"
        >
          {isPending ? '...' : '[ add ]'}
        </button>
        <button onClick={onDone} className="text-zinc-600 hover:text-zinc-400 transition-colors">
          cancel
        </button>
        {error && <span className="text-red-500 text-xs">[{error}]</span>}
      </div>
    </div>
  )
}

export default function Goals() {
  const [adding, setAdding] = useState(false)

  const { data: goals = [], isLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: listGoals,
  })

  const roots = goals.filter((g) => !g.parent_id)
  const byParent: Record<string, Goal[]> = {}
  goals.forEach((g) => {
    if (g.parent_id) {
      byParent[g.parent_id] = [...(byParent[g.parent_id] ?? []), g]
    }
  })

  function renderGoal(goal: Goal, depth: number): React.ReactNode {
    const children = byParent[goal.id] ?? []
    return (
      <GoalRow key={goal.id} goal={goal} depth={depth}>
        {children.map((c) => renderGoal(c, depth + 1))}
      </GoalRow>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-sm tracking-widest text-zinc-100">GOALS</span>
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2 py-0.5 transition-colors"
        >
          + add goal
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-6 pr-6 py-1.5 text-xs text-zinc-700 border-b border-zinc-800 shrink-0">
        <span className="w-14">status</span>
        <span className="flex-1">title</span>
        <span className="w-14 text-right">tier</span>
        <span className="w-20 text-right">target</span>
        <span className="w-6 text-right">wt</span>
        <span className="w-20" />
      </div>

      {adding && <AddGoalForm goals={goals} onDone={() => setAdding(false)} />}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-6 py-4 text-zinc-600 text-xs">loading...</div>
        ) : roots.length === 0 && !adding ? (
          <div className="px-6 py-8 text-zinc-600 text-xs">
            no goals yet — add one above.
          </div>
        ) : (
          roots.map((g) => renderGoal(g, 0))
        )}
      </div>
    </div>
  )
}
