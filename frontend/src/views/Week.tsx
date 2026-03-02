import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSchedule } from '../api/schedule'
import { listTasks } from '../api/tasks'
import LoadDots from '../components/LoadDots'
import type { ScheduleBlock, Task } from '../types'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

function offsetDate(base: Date, days: number): Date {
  const d = new Date(base)
  d.setDate(base.getDate() + days)
  return d
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function formatRange(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }).toUpperCase()
  return `${fmt(start)} – ${fmt(end)}`
}

function DayColumn({
  date,
  blocks,
  taskMap,
  isToday,
}: {
  date: Date
  blocks: ScheduleBlock[]
  taskMap: Record<string, Task>
  isToday: boolean
}) {
  const dow = date.getDay()
  const label = DAYS[dow === 0 ? 6 : dow - 1]

  return (
    <div
      className={
        'flex flex-col border-r border-zinc-800 min-w-0 flex-1 ' +
        (isToday ? 'bg-zinc-900' : 'bg-zinc-950')
      }
    >
      <div
        className={
          'px-2 py-2 border-b border-zinc-800 text-xs shrink-0 ' +
          (isToday ? 'text-emerald-400' : 'text-zinc-500')
        }
      >
        {label} {date.getDate()}
      </div>
      <div className="flex-1 overflow-y-auto">
        {blocks.length === 0 ? (
          <div className="px-2 py-3 text-zinc-700 text-xs">—</div>
        ) : (
          blocks.map((block) => {
            const task = block.task_id ? taskMap[block.task_id] : null
            return (
              <div
                key={block.id}
                className="px-2 py-1.5 border-b border-zinc-900 text-xs hover:bg-zinc-800 transition-colors"
              >
                <div className="text-zinc-600 mb-0.5">{block.start_time.slice(0, 5)}</div>
                <div className={`truncate ${task?.status === 'done' ? 'text-zinc-600 line-through' : 'text-zinc-200'}`}>
                  {task ? task.title : block.calendar_event_id ? 'external' : 'blocked'}
                </div>
                {task && <LoadDots level={task.cognitive_load} />}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default function Week() {
  const [weekOffset, setWeekOffset] = useState(0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const startDate = offsetDate(today, weekOffset * 7)
  const endDate = offsetDate(startDate, 6)
  const startStr = isoDate(startDate)
  const todayStr = isoDate(today)

  const { data: schedule } = useQuery({
    queryKey: ['schedule', startStr],
    queryFn: () => getSchedule(startStr),
    refetchInterval: weekOffset === 0 ? 60_000 : false,
  })

  const { data: tasks = [] } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => listTasks(),
  })

  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t]))
  const weekDates = Array.from({ length: 7 }, (_, i) => offsetDate(startDate, i))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-3 border-b border-zinc-800 shrink-0">
        <span className="text-sm tracking-widest text-zinc-100">WEEK</span>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setWeekOffset((n) => n - 1)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ‹ prev
          </button>
          <span className="text-zinc-500 w-32 text-center">
            {weekOffset === 0 ? 'this week' : formatRange(startDate, endDate)}
          </span>
          <button
            onClick={() => setWeekOffset((n) => n + 1)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            next ›
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              today
            </button>
          )}
        </div>
      </div>
      <div className="flex flex-1 overflow-hidden">
        {weekDates.map((date) => {
          const ds = isoDate(date)
          const dayBlocks = (schedule?.week ?? []).filter((b) => b.date === ds)
          return (
            <DayColumn
              key={ds}
              date={date}
              blocks={dayBlocks}
              taskMap={taskMap}
              isToday={ds === todayStr}
            />
          )
        })}
      </div>
    </div>
  )
}
