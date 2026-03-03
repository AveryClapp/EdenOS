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
        borderRight: '1px solid #b0a085',
        background: isToday ? '#ccbd9e' : '#c8b89a',
      }}
    >
      <div
        className="px-2 py-2 text-xs shrink-0"
        style={{
          borderBottom: '1px solid #b0a085',
          color: isToday ? '#4a8c5c' : '#7a6550',
        }}
      >
        {label} {date.getDate()}
      </div>
      <div className="flex-1 overflow-y-auto">
        {blocks.length === 0 ? (
          <div className="px-2 py-3 text-xs" style={{ color: '#a89070' }}>—</div>
        ) : (
          blocks.map((block) => {
            const task = block.task_id ? taskMap[block.task_id] : null
            return (
              <div
                key={block.id}
                className="px-2 py-1.5 text-xs transition-colors"
                style={{ borderBottom: '1px solid #c8b89a' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#bfad90')}
                onMouseLeave={e => (e.currentTarget.style.background = '')}
              >
                <div className="mb-0.5" style={{ color: '#7a6550' }}>{block.start_time.slice(0, 5)}</div>
                <div className="truncate" style={{ color: task?.status === 'done' ? '#8a7860' : '#1a1208', textDecoration: task?.status === 'done' ? 'line-through' : 'none' }}>
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
      <div className="flex items-center justify-between px-6 py-3 shrink-0" style={{ borderBottom: '1px solid #b0a085' }}>
        <span className="text-sm tracking-widest" style={{ color: '#1a1208' }}>WEEK</span>
        <div className="flex items-center gap-3 text-xs">
          <button
            onClick={() => setWeekOffset((n) => n - 1)}
            className="transition-colors"
            style={{ color: '#7a6550' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#1a1208')}
            onMouseLeave={e => (e.currentTarget.style.color = '#7a6550')}
          >
            ‹ prev
          </button>
          <span className="w-32 text-center" style={{ color: '#7a6550' }}>
            {weekOffset === 0 ? 'this week' : formatRange(startDate, endDate)}
          </span>
          <button
            onClick={() => setWeekOffset((n) => n + 1)}
            className="transition-colors"
            style={{ color: '#7a6550' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#1a1208')}
            onMouseLeave={e => (e.currentTarget.style.color = '#7a6550')}
          >
            next ›
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              className="transition-colors"
              style={{ color: '#8a7860' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#5a4535')}
              onMouseLeave={e => (e.currentTarget.style.color = '#8a7860')}
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
