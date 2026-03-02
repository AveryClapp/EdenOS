import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { listGoals } from '../api/goals'
import { listProjects, createProject, updateProject } from '../api/projects'
import { listTasks, createTask, updateTask } from '../api/tasks'
import LoadDots from '../components/LoadDots'
import type { Goal, Project, Task } from '../types'

const CAT_COLORS: Record<string, string> = {
  research: 'text-violet-400',
  engineering: 'text-blue-400',
  academic: 'text-cyan-400',
  athletic: 'text-emerald-400',
  career: 'text-amber-400',
  personal: 'text-zinc-400',
}

const STATUS_COLORS: Record<string, string> = {
  active: 'text-emerald-400',
  paused: 'text-yellow-500',
  done: 'text-zinc-600',
  dropped: 'text-zinc-700',
}

const TASK_STATUS_COLORS: Record<string, string> = {
  backlog: 'text-zinc-500',
  active: 'text-blue-400',
  in_progress: 'text-amber-400',
  done: 'text-emerald-600',
  deferred: 'text-zinc-600',
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

function TaskRow({ task }: { task: Task }) {
  const qc = useQueryClient()
  const [expanded, setExpanded] = useState(false)

  const { mutate: advance } = useMutation({
    mutationFn: (status: string) => updateTask(task.id, { status: status as Task['status'] }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  })

  return (
    <div className="border-b border-zinc-900">
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs hover:bg-zinc-900 transition-colors">
        <button
          className={`w-20 shrink-0 text-left ${TASK_STATUS_COLORS[task.status]} hover:opacity-70 transition-opacity`}
          onClick={() => advance(STATUS_NEXT[task.status])}
          title={STATUS_NEXT_LABEL[task.status]}
        >
          {task.status}
        </button>
        <button
          className={`flex-1 text-left ${task.status === 'done' ? 'line-through text-zinc-600' : 'text-zinc-200'}`}
          onClick={() => setExpanded((v) => !v)}
        >
          {task.title}
        </button>
        <LoadDots level={task.cognitive_load} />
        <span className="text-zinc-600 w-14 text-right shrink-0">{task.estimated_minutes}m</span>
        {task.deadline && (
          <span className="text-amber-600 shrink-0">{task.deadline.slice(0, 10)}</span>
        )}
        {task.recurrence_rule && (
          <span className="text-zinc-700 shrink-0">↻</span>
        )}
      </div>
      {expanded && (
        <div className="px-4 pb-2 pt-1 bg-zinc-900 text-xs space-y-1">
          {task.description ? (
            <p className="text-zinc-400 leading-relaxed whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-zinc-700 italic">no description</p>
          )}
          <div className="flex gap-4 text-zinc-600">
            {task.deadline && <span>deadline: <span className="text-amber-600">{task.deadline.slice(0, 10)}</span></span>}
            {task.recurrence_rule && <span>recurs: <span className="text-zinc-400">{task.recurrence_rule}</span></span>}
            <span>source: {task.source}</span>
          </div>
        </div>
      )}
    </div>
  )
}

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

  return (
    <div className="px-4 py-2 text-xs bg-zinc-900 border-b border-zinc-800 space-y-1.5">
      <div className="flex items-center gap-2">
        <input
          autoFocus
          placeholder="task title"
          className="flex-1 bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        />
        <span className="text-zinc-600">load</span>
        <select
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={load}
          onChange={(e) => setLoad(e.target.value)}
        >
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
        </select>
        <span className="text-zinc-600">mins</span>
        <input
          className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={mins}
          onChange={(e) => setMins(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <span className="text-zinc-600">deadline</span>
        <input
          type="date"
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
        />
        <span className="text-zinc-600">recurs</span>
        <select
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
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
          className="text-emerald-400 hover:text-emerald-300 disabled:text-zinc-700 transition-colors ml-auto"
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

  const { mutate: patch } = useMutation({
    mutationFn: (body: Parameters<typeof updateProject>[1]) => updateProject(project.id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['projects'] }),
  })

  const openCount = tasks.filter((t) => t.status !== 'done').length

  return (
    <div className="border-b border-zinc-800">
      <div
        className="flex items-center gap-3 px-6 py-2.5 text-sm hover:bg-zinc-900 transition-colors cursor-pointer group"
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="text-zinc-600 text-xs w-3 shrink-0">{expanded ? '▾' : '▸'}</span>
        <span
          className={`font-medium flex-1 ${project.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-100'}`}
        >
          {project.title}
        </span>
        <span className={`text-xs w-24 shrink-0 ${CAT_COLORS[project.category] ?? 'text-zinc-500'}`}>
          {project.category}
        </span>
        <span className="text-zinc-600 text-xs w-16 text-right shrink-0">
          {project.estimated_hours_remaining.toFixed(0)}h left
        </span>
        <span className="text-zinc-600 text-xs w-14 text-right shrink-0">
          p={project.priority_score.toFixed(2)}
        </span>
        <span className={`text-xs w-16 text-right shrink-0 ${STATUS_COLORS[project.status]}`}>
          [{project.status}]
        </span>
        <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity text-xs w-10 justify-end shrink-0">
          {project.status === 'active' && (
            <button
              className="text-zinc-500 hover:text-zinc-300"
              onClick={(e) => {
                e.stopPropagation()
                patch({ status: 'done' })
              }}
            >
              done
            </button>
          )}
        </div>
      </div>

      {expanded && (
        <div className="bg-zinc-950">
          <div className="flex items-center justify-between px-4 py-1.5 border-b border-zinc-800">
            <span className="text-zinc-600 text-xs">
              {goalTitle} / {openCount} open task{openCount !== 1 ? 's' : ''}
            </span>
            <button
              onClick={() => setAddingTask(true)}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              + task
            </button>
          </div>

          {addingTask && (
            <AddTaskForm projectId={project.id} onDone={() => setAddingTask(false)} />
          )}

          {tasks.length === 0 && !addingTask ? (
            <div className="px-4 py-3 text-zinc-700 text-xs">no tasks</div>
          ) : (
            tasks.map((t) => <TaskRow key={t.id} task={t} />)
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

  return (
    <div className="px-6 py-3 border-b border-zinc-800 bg-zinc-900 text-xs">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          autoFocus
          placeholder="project title"
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-2 py-1 font-mono text-xs flex-1 min-w-48"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') onDone() }}
        />
        <select
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={goalId}
          onChange={(e) => setGoalId(e.target.value)}
        >
          {goals.map((g) => (
            <option key={g.id} value={g.id}>{g.title}</option>
          ))}
        </select>
        <select
          className="bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {['research', 'engineering', 'academic', 'athletic', 'career', 'personal'].map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <span className="text-zinc-500">hrs</span>
        <input
          className="w-14 bg-zinc-800 border border-zinc-700 text-zinc-100 px-1 py-1 font-mono text-xs"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <button
          onClick={() => mutate()}
          disabled={isPending || !title || !goalId}
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
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-sm tracking-widest text-zinc-100">PROJECTS</span>
        <button
          onClick={() => setAdding(true)}
          className="text-xs text-zinc-500 hover:text-zinc-300 border border-zinc-700 hover:border-zinc-500 px-2 py-0.5 transition-colors"
        >
          + add project
        </button>
      </div>

      <div className="flex items-center gap-3 px-6 py-1.5 text-xs text-zinc-700 border-b border-zinc-800 shrink-0">
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
          <div className="px-6 py-4 text-zinc-600 text-xs">loading...</div>
        ) : projects.length === 0 && !adding ? (
          <div className="px-6 py-8 text-zinc-600 text-xs">no projects — add one above.</div>
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
