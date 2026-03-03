import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listGoals } from '../api/goals'
import { listProjects, createProject, updateProject } from '../api/projects'
import { listTasks, createTask, updateTask, deleteTask } from '../api/tasks'
import { deleteProject } from '../api/projects'
import { syncGitHub } from '../api/github'
import LoadDots from '../components/LoadDots'
import type { Goal, Project, Task } from '../types'

const CAT_COLORS: Record<string, string> = {
  research: 'text-violet-600',
  engineering: 'text-blue-600',
  academic: 'text-cyan-700',
  athletic: 'text-emerald-600',
  career: 'text-amber-700',
  personal: 'text-stone-500',
}

const STATUS_PILL: Record<string, { background: string; color: string }> = {
  active:  { background: '#142810', color: '#4a8c5c' },
  paused:  { background: '#d8c8a0', color: '#8a6a10' },
  done:    { background: '#ddd3be', color: '#7a6550' },
  dropped: { background: '#ddd3be', color: '#8a7860' },
}

const TASK_STATUS_COLORS: Record<string, string> = {
  backlog: 'text-stone-500',
  active: 'text-blue-600',
  in_progress: 'text-amber-700',
  done: 'text-emerald-700',
  deferred: 'text-stone-400',
}

// backlog → active → in_progress → deferred → backlog; done resets to backlog
const STATUS_NEXT: Record<string, string> = {
  backlog: 'active',
  active: 'in_progress',
  in_progress: 'deferred',
  deferred: 'backlog',
  done: 'backlog',
}

const STATUS_NEXT_LABEL: Record<string, string> = {
  backlog: 'advance → active',
  active: 'advance → in_progress',
  in_progress: 'advance → deferred',
  deferred: 'un-defer → backlog',
  done: 'reopen → backlog',
}

function UrgencyBadge({ urgency }: { urgency?: number | null }) {
  if (urgency == null) return null
  let color = 'text-stone-400'
  if (urgency > 6) color = 'text-red-500'
  else if (urgency > 3) color = 'text-orange-600'
  else if (urgency > 1.5) color = 'text-yellow-700'
  else color = 'text-emerald-700'
  return (
    <span className={`text-xs font-mono shrink-0 ${color}`} title={`urgency: ${urgency.toFixed(2)}`}>
      ↑{urgency.toFixed(1)}
    </span>
  )
}

function TaskRow({ task, projectTasks }: { task: Task; projectTasks: Task[] }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState(task.title)
  const [editDesc, setEditDesc] = useState(task.description ?? '')
  const [editMins, setEditMins] = useState(String(task.estimated_minutes))
  const [editDeps, setEditDeps] = useState<string[]>(task.dependency_ids ?? [])

  const { mutate: advance } = useMutation({
    mutationFn: (status: string) => updateTask(task.id, { status: status as Task['status'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  const { mutate: save } = useMutation({
    mutationFn: () =>
      updateTask(task.id, {
        title: editTitle,
        description: editDesc || null,
        estimated_minutes: Number(editMins),
        dependency_ids: editDeps,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setEditing(false)
    },
  })

  const { mutate: remove } = useMutation({
    mutationFn: () => deleteTask(task.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
    },
  })

  function openEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setEditTitle(task.title)
    setEditDesc(task.description ?? '')
    setEditMins(String(task.estimated_minutes))
    setEditDeps(task.dependency_ids ?? [])
    setEditing(true)
    setExpanded(true)
  }

  return (
    <div style={{ borderBottom: '1px solid #c8b89a' }}>
      <div
        className="flex items-center gap-3 px-4 py-1.5 text-xs transition-colors group"
        style={{ background: 'transparent' }}
        onMouseEnter={e => (e.currentTarget.style.background = '#c4b494')}
        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
      >
        <button
          className={`w-20 shrink-0 text-left hover:opacity-70 transition-opacity ${TASK_STATUS_COLORS[task.status]}`}
          onClick={() => advance(STATUS_NEXT[task.status])}
          title={STATUS_NEXT_LABEL[task.status]}
        >
          {task.status}
        </button>
        <button
          className="flex-1 text-left"
          style={{ color: task.status === 'done' ? '#8a7860' : '#1a1208', textDecoration: task.status === 'done' ? 'line-through' : 'none' }}
          onClick={() => setExpanded((v) => !v)}
        >
          {task.title}
        </button>
        <LoadDots level={task.cognitive_load} />
        <UrgencyBadge urgency={task.urgency} />
        <span className="w-14 text-right shrink-0" style={{ color: '#8a7860' }}>{task.estimated_minutes}m</span>
        {task.deadline && (
          <span className="text-amber-700 shrink-0">{task.deadline.slice(0, 10)}</span>
        )}
        {task.recurrence_rule && (
          <span className="shrink-0" style={{ color: '#8a7860' }}>↻</span>
        )}
        {task.dependency_ids && task.dependency_ids.length > 0 && (
          <span className="text-xs shrink-0" style={{ color: '#8a7860' }} title="has dependencies">
            ⇢{task.dependency_ids.length}
          </span>
        )}
        <button
          className="opacity-0 group-hover:opacity-100 transition-all shrink-0"
          style={{ color: '#8a7860' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#5a4535')}
          onMouseLeave={e => (e.currentTarget.style.color = '#8a7860')}
          onClick={openEdit}
          title="edit task"
        >
          ✎
        </button>
      </div>
      {expanded && !editing && (
        <div className="px-4 pb-2 pt-1 text-xs space-y-1" style={{ background: '#c4b494' }}>
          {task.description ? (
            <p className="leading-relaxed whitespace-pre-wrap" style={{ color: '#5a4535' }}>{task.description}</p>
          ) : (
            <p className="italic" style={{ color: '#8a7860' }}>no description</p>
          )}
          <div className="flex gap-4" style={{ color: '#7a6550' }}>
            {task.deadline && <span>deadline: <span className="text-amber-700">{task.deadline.slice(0, 10)}</span></span>}
            {task.recurrence_rule && <span>recurs: <span style={{ color: '#5a4535' }}>{task.recurrence_rule}</span></span>}
            <span>source: {task.source}</span>
          </div>
        </div>
      )}
      {editing && (
        <div className="px-4 pb-2 pt-1.5 text-xs space-y-1.5" style={{ background: '#c4b494', borderTop: '1px solid #b0a085' }}>
          <input
            autoFocus
            className="w-full px-2 py-1 font-mono text-xs"
            style={{ background: '#d4c4aa', border: '1px solid #b0a085', color: '#1a1208' }}
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setEditing(false) }}
          />
          <textarea
            className="w-full px-2 py-1 font-mono text-xs resize-none"
            style={{ background: '#d4c4aa', border: '1px solid #b0a085', color: '#5a4535' }}
            rows={2}
            placeholder="description (optional)"
            value={editDesc}
            onChange={(e) => setEditDesc(e.target.value)}
          />
          {projectTasks.length > 0 && (
            <div>
              <span style={{ color: '#7a6550' }}>blocks on:</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {projectTasks.map((pt) => (
                  <label key={pt.id} className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editDeps.includes(pt.id)}
                      onChange={(e) =>
                        setEditDeps((prev) =>
                          e.target.checked
                            ? [...prev, pt.id]
                            : prev.filter((id) => id !== pt.id)
                        )
                      }
                      className="accent-emerald-600"
                    />
                    <span className={`text-xs`} style={{ color: pt.status === 'done' ? '#8a7860' : '#5a4535', textDecoration: pt.status === 'done' ? 'line-through' : 'none' }}>
                      {pt.title}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span style={{ color: '#7a6550' }}>mins</span>
            <input
              className="w-16 px-1 py-0.5 font-mono text-xs"
              style={{ background: '#d4c4aa', border: '1px solid #b0a085', color: '#1a1208' }}
              value={editMins}
              onChange={(e) => setEditMins(e.target.value)}
            />
            <button
              onClick={() => save()}
              disabled={!editTitle}
              className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors ml-auto"
              style={{ background: '#bfad90', color: '#1a1208' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#b0a085')}
              onMouseLeave={e => (e.currentTarget.style.background = '#bfad90')}
            >
              Save
            </button>
            <button
              onClick={() => setEditing(false)}
              className="transition-colors"
              style={{ color: '#7a6550' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#5a4535')}
              onMouseLeave={e => (e.currentTarget.style.color = '#7a6550')}
            >
              cancel
            </button>
            <button
              onClick={() => { if (confirm(`Delete "${task.title}"?`)) remove() }}
              className="transition-colors"
              style={{ color: '#8a7860' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
              onMouseLeave={e => (e.currentTarget.style.color = '#8a7860')}
            >
              delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const LOAD_DEFAULT_MINS: Record<string, string> = { '1': '30', '2': '60', '3': '120' }

function AddTaskForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [load, setLoad] = useState('2')
  const [mins, setMins] = useState('60')
  const [deadline, setDeadline] = useState('')
  const [recurrence, setRecurrence] = useState('')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createTask({
        project_id: projectId,
        title,
        cognitive_load: Number(load),
        estimated_minutes: Number(mins),
        deadline: deadline || undefined,
        recurrence_rule: recurrence || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  const fieldCls = "px-2 py-1 font-mono text-xs"
  const fieldStyle = { background: '#d4c4aa', border: '1px solid #b0a085', color: '#1a1208' }

  return (
    <div className="px-4 py-2 text-xs space-y-1.5" style={{ background: '#c4b494', borderBottom: '1px solid #b0a085' }}>
      <div className="flex items-center gap-2">
        <input
          autoFocus
          placeholder="task title"
          className={`flex-1 ${fieldCls}`}
          style={fieldStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        />
        <span style={{ color: '#7a6550' }}>load</span>
        <select
          className={fieldCls}
          style={fieldStyle}
          value={load}
          onChange={(e) => { setLoad(e.target.value); setMins(LOAD_DEFAULT_MINS[e.target.value]) }}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
        <span style={{ color: '#7a6550' }}>mins</span>
        <input
          className={`w-14 ${fieldCls}`}
          style={fieldStyle}
          value={mins}
          onChange={(e) => setMins(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <span style={{ color: '#7a6550' }}>deadline</span>
        <input
          type="date"
          className={fieldCls}
          style={fieldStyle}
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        <span style={{ color: '#7a6550' }}>recurs</span>
        <select
          className={fieldCls}
          style={fieldStyle}
          value={recurrence}
          onChange={(e) => setRecurrence(e.target.value)}
        >
          <option value="">none</option>
          <option value="daily">daily</option>
          <option value="weekly">weekly</option>
          <option value="biweekly">biweekly</option>
          <option value="monthly">monthly</option>
        </select>
        <button
          onClick={() => mutate()}
          disabled={isPending || !title}
          className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors ml-auto"
          style={{ background: isPending || !title ? '#bfad90' : '#d4c4aa', color: '#1a1208', border: '1px solid #b0a085' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#b0a085')}
          onMouseLeave={e => (e.currentTarget.style.background = isPending || !title ? '#bfad90' : '#d4c4aa')}
        >
          {isPending ? '…' : '+ Add task'}
        </button>
        <button
          onClick={onDone}
          className="text-xs transition-colors"
          style={{ color: '#7a6550' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#1a1208')}
          onMouseLeave={e => (e.currentTarget.style.color = '#7a6550')}
        >
          Cancel
        </button>
        {error && <span className="text-red-500 text-xs">{error}</span>}
      </div>
    </div>
  )
}

function ProjectCard({
  project,
  tasks,
  goalTitle,
}: {
  project: Project
  tasks: Task[]
  goalTitle: string
}) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)
  const [addingTask, setAddingTask] = useState(false)
  const [syncResult, setSyncResult] = useState<{ imported: number; skipped: number } | null>(null)
  const [syncError, setSyncError] = useState<string | null>(null)

  const { mutate: doSync, isPending: syncing } = useMutation({
    mutationFn: () => syncGitHub(project.id),
    onSuccess: (data) => {
      setSyncResult(data)
      setSyncError(null)
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (e: Error) => {
      setSyncError(e.message)
      setSyncResult(null)
    },
  })

  const { mutate: patch } = useMutation({
    mutationFn: (body: Parameters<typeof updateProject>[1]) => updateProject(project.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  const { mutate: remove } = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
    },
  })

  const openCount = tasks.filter((t) => t.status !== 'done').length

  return (
    <div className="border-b" style={{ borderColor: '#b0a085' }}>
      <div
        className="flex items-center gap-3 px-6 py-3 text-sm cursor-pointer group transition-colors"
        onMouseEnter={e => (e.currentTarget.style.background = '#c4b494')}
        onMouseLeave={e => (e.currentTarget.style.background = '')}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-xs w-3 shrink-0" style={{ color: '#8a7860' }}>{expanded ? '▾' : '▸'}</span>
        <span className="font-medium flex-1" style={{ color: project.status === 'done' ? '#8a7860' : '#1a1208', textDecoration: project.status === 'done' ? 'line-through' : 'none' }}>
          {project.title}
        </span>
        <span className={`text-xs w-24 shrink-0 ${CAT_COLORS[project.category] ?? 'text-stone-500'}`}>
          {project.category}
        </span>
        <span className="text-xs font-mono w-16 text-right shrink-0" style={{ color: '#6b5040' }}>
          {project.estimated_hours_remaining.toFixed(0)}h left
        </span>
        <span className="text-xs font-mono w-14 text-right shrink-0" style={{ color: '#8a7860' }}>
          {project.priority_score.toFixed(2)}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-full w-16 text-center shrink-0"
          style={STATUS_PILL[project.status] ?? { background: '#ddd3be', color: '#7a6550' }}>
          {project.status}
        </span>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs w-28 justify-end shrink-0">
          {project.status === 'active' && (
            <>
              <button className="transition-colors" style={{ color: '#6b5040' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#8a7860')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b5040')}
                onClick={(e) => { e.stopPropagation(); patch({ status: 'paused' }) }}>pause</button>
              <button className="transition-colors" style={{ color: '#6b5040' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#8a7860')}
                onMouseLeave={e => (e.currentTarget.style.color = '#6b5040')}
                onClick={(e) => { e.stopPropagation(); patch({ status: 'done' }) }}>done</button>
            </>
          )}
          {project.status === 'paused' && (
            <button style={{ color: '#8a6a10' }}
              onClick={(e) => { e.stopPropagation(); patch({ status: 'active' }) }}>resume</button>
          )}
          <button className="transition-colors" style={{ color: '#8a7860' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#ef4444')}
            onMouseLeave={e => (e.currentTarget.style.color = '#8a7860')}
            onClick={(e) => { e.stopPropagation(); if (confirm(`Delete "${project.title}" and all its tasks?`)) remove() }}>del</button>
        </div>
      </div>

      {expanded && (
        <div style={{ background: '#c4b494' }}>
          <div className="flex items-center justify-between px-4 py-2 border-b" style={{ borderColor: '#b0a085' }}>
            <span className="text-xs" style={{ color: '#6b5040' }}>
              {goalTitle} · {openCount} open task{openCount !== 1 ? 's' : ''}
              {syncResult && (
                <span style={{ color: '#8a6a10', marginLeft: 8 }}>
                  ↓ {syncResult.imported} imported{syncResult.skipped > 0 ? `, ${syncResult.skipped} skipped` : ''}
                </span>
              )}
              {syncError && (
                <span style={{ color: '#ef4444', marginLeft: 8 }}>{syncError}</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => doSync()}
                disabled={syncing}
                className="text-xs transition-colors"
                style={{ color: syncing ? '#a89070' : '#6b5040' }}
                title="Import assigned GitHub issues and review-requested PRs"
              >
                {syncing ? 'syncing…' : '↓ GitHub'}
              </button>
              <button onClick={() => setAddingTask(true)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                style={{ background: '#7c3400', color: '#f0e8d8' }}>
                + Add task
              </button>
            </div>
          </div>

          {addingTask && (
            <AddTaskForm projectId={project.id} onDone={() => setAddingTask(false)} />
          )}

          {tasks.length === 0 && !addingTask ? (
            <div className="px-4 py-3 text-xs" style={{ color: '#8a7860' }}>no tasks</div>
          ) : (
            tasks.map((t) => (
              <TaskRow
                key={t.id}
                task={t}
                projectTasks={tasks.filter((pt) => pt.id !== t.id)}
              />
            ))
          )}
        </div>
      )}
    </div>
  )
}

function AddProjectForm({ goals, onDone }: { goals: Goal[]; onDone: () => void }) {
  const qc = useQueryClient()
  const [title, setTitle] = useState('')
  const [goalId, setGoalId] = useState(goals[0]?.id ?? '')
  const [category, setCategory] = useState('engineering')
  const [hours, setHours] = useState('10')
  const [error, setError] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      createProject({
        title,
        goal_id: goalId,
        category,
        estimated_hours_remaining: Number(hours),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      onDone()
    },
    onError: (e: Error) => setError(e.message),
  })

  const fieldCls = "px-2 py-1 font-mono text-xs"
  const fieldStyle = { background: '#d4c4aa', border: '1px solid #b0a085', color: '#1a1208' }

  return (
    <div className="px-6 py-3 border-b text-xs" style={{ background: '#c4b494', borderColor: '#b0a085' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <input
          autoFocus
          placeholder="project title"
          className={`${fieldCls} flex-1 min-w-48`}
          style={fieldStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        />
        <select className={fieldCls} style={fieldStyle} value={goalId} onChange={(e) => setGoalId(e.target.value)}>
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <select className={fieldCls} style={fieldStyle} value={category} onChange={(e) => setCategory(e.target.value)}>
          {['research', 'engineering', 'academic', 'athletic', 'career', 'personal'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span style={{ color: '#7a6550' }}>hrs</span>
        <input
          className={`w-14 ${fieldCls}`}
          style={fieldStyle}
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <button
          onClick={() => mutate()}
          disabled={isPending || !title || !goalId}
          className="text-xs font-medium px-3 py-1.5 rounded-md transition-colors"
          style={{ background: '#bfad90', color: '#1a1208', border: '1px solid #b0a085' }}
          onMouseEnter={e => (e.currentTarget.style.background = '#b0a085')}
          onMouseLeave={e => (e.currentTarget.style.background = '#bfad90')}
        >
          {isPending ? '…' : '+ Add project'}
        </button>
        <button
          onClick={onDone}
          className="text-xs transition-colors"
          style={{ color: '#7a6550' }}
          onMouseEnter={e => (e.currentTarget.style.color = '#1a1208')}
          onMouseLeave={e => (e.currentTarget.style.color = '#7a6550')}
        >
          Cancel
        </button>
        {error && <span className="text-red-500 text-xs">{error}</span>}
      </div>
    </div>
  )
}

export default function Projects() {
  const [adding, setAdding] = useState(false)

  const { data: goals = [] } = useQuery({ queryKey: ['goals'], queryFn: listGoals })
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: listProjects,
  })
  const { data: tasks = [] } = useQuery({ queryKey: ['tasks'], queryFn: () => listTasks() })

  const goalMap = Object.fromEntries(goals.map((g) => [g.id, g]))
  const tasksByProject: Record<string, Task[]> = {}
  tasks.forEach((t) => {
    tasksByProject[t.project_id] = [...(tasksByProject[t.project_id] ?? []), t]
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b shrink-0" style={{ borderColor: '#b0a085' }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 300, color: '#1a1208' }}>Projects</span>
        <button onClick={() => setAdding(true)}
          className="text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
          style={{ background: '#7c3400', color: '#f0e8d8' }}>
          + Add project
        </button>
      </div>

      <div className="flex items-center gap-3 px-6 py-1.5 text-xs border-b shrink-0" style={{ color: '#8a7860', borderColor: '#b0a085' }}>
        <span className="w-3" />
        <span className="flex-1">title</span>
        <span className="w-24">category</span>
        <span className="w-16 text-right">hours</span>
        <span className="w-14 text-right">priority</span>
        <span className="w-16 text-right">status</span>
        <span className="w-10" />
      </div>

      {adding && <AddProjectForm goals={goals} onDone={() => setAdding(false)} />}

      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="px-6 py-4 text-xs" style={{ color: '#8a7860' }}>loading...</div>
        ) : projects.length === 0 && !adding ? (
          <div className="px-6 py-8 text-xs" style={{ color: '#8a7860' }}>no projects — add one above.</div>
        ) : (
          projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              tasks={tasksByProject[p.id] ?? []}
              goalTitle={goalMap[p.goal_id]?.title ?? ''}
            />
          ))
        )}
      </div>
    </div>
  )
}
