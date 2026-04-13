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
      className="flex flex-col min-w-0 flex-1"
      style={{
        borderRight: '1px solid #27272a',
        background: isToday ? '#111113' : '#09090b',
      }}
    >
      <div
        className="px-2 py-2 text-xs shrink-0"
        style={{
          borderBottom: '1px solid #27272a',
          color: isToday ? '#fbbf24' : '#52525b',
        }}
      >
        {label} {date.getDate()}
      </div>
      <div className="flex-1 overflow-y-auto">
        {blocks.length === 0 ? (
          <div className="px-2 py-3 text-xs" style={{ color: '#3f3f46' }}>—</div>
        ) : (
          blocks.map((block) => {
            const task = block.task_id ? taskMap[block.task_id] : null
            return (
              <div
                key={block.id}
                className="px-2 py-1.5 text-xs transition-colors"
                style={{ borderBottom: '1px solid #18181b' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#18181b')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div className="mb-0.5" style={{ color: '#52525b' }}>{block.start_time.slice(0, 5)}</div>
                <div className="truncate" style={{ color: task?.status === 'done' ? '#52525b' : '#e4e4e7', textDecoration: task?.status === 'done' ? 'line-through' : 'none' }}>
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
      <div className="flex items-center justify-between px-6 py-3 shrink-0" style={{ borderBottom: '1px solid #27272a' }}>
        <span className="section-head">Week</span>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setWeekOffset((n) => n - 1)}
            className="transition-colors"
            style={{ color: '#52525b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#a1a1aa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#52525b')}
          >
            ‹ prev
          </button>
          <span className="w-32 text-center" style={{ color: '#52525b' }}>
            {weekOffset === 0 ? 'this week' : formatRange(startDate, endDate)}
          </span>
          <button
            onClick={() => setWeekOffset((n) => n + 1)}
            className="transition-colors"
            style={{ color: '#52525b' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#a1a1aa')}
            onMouseLeave={e => (e.currentTarget.style.color = '#52525b')}
          >
            next ›
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="transition-colors"
              style={{ color: '#71717a' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#a1a1aa')}
              onMouseLeave={e => (e.currentTarget.style.color = '#71717a')}
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
