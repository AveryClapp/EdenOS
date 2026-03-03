import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listGoals, createGoal, updateGoal, deleteGoal } from '../api/goals'
import type { Goal } from '../types'

const STATUS_PILL: Record<string, { bg: string; color: string }> = {
  active:  { bg: '#14240f', color: '#4a8c5c' },
  paused:  { bg: '#2a2004', color: '#c49a28' },
  done:    { bg: '#1a1710', color: '#5a5040' },
  dropped: { bg: '#1a1710', color: '#3d3428' },
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
        className="flex items-center gap-3 py-2 pr-6 text-sm border-b transition-colors group"
        style={{ paddingLeft: `${24 + depth * 20}px`, borderColor: '#1a1410' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#120e07')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
      >
        <span
          className="text-xs px-2 py-0.5 rounded-full shrink-0 w-16 text-center"
          style={STATUS_PILL[goal.status] ?? { bg: '#1a1710', color: '#5a5040' }}
        >
          {goal.status}
        </span>

        {editing ? (
          <input
            autoFocus
            className="flex-1 text-sm px-2 py-0.5 border outline-none"
            style={{ background: '#1a1208', borderColor: '#3d3020', color: '#ede8e0', borderRadius: '6px' }}
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
            className="flex-1 cursor-pointer"
            style={{ color: isInactive ? '#4a3f30' : '#ede8e0', textDecoration: isInactive ? 'line-through' : 'none' }}
            onClick={() => setEditing(true)}
          >
            {goal.title}
          </span>
        )}

        <span className="text-xs shrink-0 w-14 text-right" style={{ color: '#6b5a47' }}>{TIER_LABEL[goal.tier]}</span>
        <span className="text-xs font-mono shrink-0 w-20 text-right" style={{ color: '#6b5a47' }}>{goal.target_date}</span>
        <span className="text-xs font-mono shrink-0 w-6 text-right" style={{ color: '#6b5a47' }}>{goal.weight.toFixed(1)}</span>

        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs w-28 justify-end shrink-0">
          {goal.status === 'active' && (
            <>
              <button className="transition-colors" style={{ color: '#6b5a47' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a89070')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b5a47')}
                onClick={() => patch({ status: 'done' })}>done</button>
              <button className="transition-colors" style={{ color: '#6b5a47' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#a89070')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b5a47')}
                onClick={() => patch({ status: 'paused' })}>pause</button>
            </>
          )}
          {goal.status === 'paused' && (
            <button className="transition-colors" style={{ color: '#c49a28' }}
              onClick={() => patch({ status: 'active' })}>resume</button>
          )}
          <button
            className="transition-colors" style={{ color: '#4a3f30' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#4a3f30')}
            onClick={() => { if (confirm(`Delete "${goal.title}"?`)) remove() }}
          >del</button>
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

  const inputCls = "text-xs px-2 py-1.5 border outline-none"
  const inputStyle = { background: '#1a1208', borderColor: '#3d3020', color: '#ede8e0', borderRadius: '8px' }

  return (
    <div className="px-6 py-3 border-b text-xs" style={{ background: '#120e07', borderColor: '#2a2118' }}>
      <div className="flex items-center gap-2.5 flex-wrap">
        <input autoFocus placeholder="Goal title" className={`${inputCls} flex-1 min-w-48`} style={inputStyle}
          value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') onDone() }} />
        <select className={inputCls} style={inputStyle} value={tier} onChange={(e) => setTier(e.target.value as 'long' | 'mid')}>
          <option value="long">Long-term (6–24mo)</option>
          <option value="mid">Mid-term (2–8wk)</option>
        </select>
        <select className={inputCls} style={inputStyle} value={parentId} onChange={(e) => setParentId(e.target.value)}>
          <option value="">No parent</option>
          {goals.map((g) => (<option key={g.id} value={g.id}>{g.title}</option>))}
        </select>
        <input type="date" className={inputCls} style={inputStyle} value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
        <span style={{ color: '#6b5a47' }}>weight</span>
        <input className={`w-14 ${inputCls}`} style={inputStyle} value={weight} onChange={(e) => setWeight(e.target.value)} />
        <button onClick={() => mutate()} disabled={isPending || !title || !targetDate}
          className="text-xs font-medium text-white px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: isPending || !title || !targetDate ? '#2a2118' : '#92400e', color: isPending || !title || !targetDate ? '#4a3f30' : '#fff' }}>
          {isPending ? '…' : 'Add goal'}
        </button>
        <button onClick={onDone} className="text-xs transition-colors" style={{ color: '#6b5a47' }}>Cancel</button>
        {error && <span className="text-red-400 text-xs">{error}</span>}
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
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: '#1e1710' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 300, color: '#f0e6d3' }}>Goals</span>
        <button onClick={() => setAdding(true)}
          className="text-xs font-medium text-white px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: '#92400e' }}>
          + Add goal
        </button>
      </div>

      {/* Column headers */}
      <div className="flex items-center gap-3 px-6 pr-6 py-1.5 text-xs border-b shrink-0" style={{ color: '#4a3f30', borderColor: '#1a1410' }}>
        <span className="w-16">status</span>
        <span className="flex-1">title</span>
        <span className="w-14 text-right">tier</span>
        <span className="w-20 text-right">target</span>
        <span className="w-6 text-right">wt</span>
        <span className="w-20" />
      </div>

      {adding && <AddGoalForm goals={goals} onDone={() => setAdding(false)} />}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-6 py-4 text-xs" style={{ color: '#4a3f30' }}>Loading…</div>
        ) : roots.length === 0 && !adding ? (
          <div className="px-6 py-8 text-xs" style={{ color: '#4a3f30' }}>
            No goals yet — add your first one above.
          </div>
        ) : (
          roots.map((g) => renderGoal(g, 0))
        )}
      </div>
    </div>
  )
}
