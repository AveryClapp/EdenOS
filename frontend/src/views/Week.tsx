import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSchedule } from '../api/schedule'
import { listTasks } from '../api/tasks'
import type { ScheduleBlock, Task } from '../types'

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']

const LOAD_COLOR: Record<number, string> = { 1: '#316a86', 2: '#5fa8c8', 3: '#00badc' }

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
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid rgba(0,186,220,0.06)',
        background: isToday ? 'rgba(0,186,220,0.02)' : 'transparent',
      }}
    >
      {/* Day header */}
      <div style={{
        padding: '7px 8px 6px',
        borderBottom: '1px solid rgba(0,186,220,0.06)',
        display: 'flex',
        alignItems: 'baseline',
        gap: 5,
      }}>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.1em',
          color: isToday ? '#00badc' : '#316a86',
        }}>
          {label}
        </span>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: isToday ? 'rgba(0,186,220,0.6)' : '#1e4d6b',
        }}>
          {date.getDate()}
        </span>
        {isToday && (
          <span style={{ marginLeft: 'auto', width: 4, height: 4, borderRadius: '50%', background: '#00badc', display: 'inline-block', boxShadow: '0 0 6px rgba(0,186,220,0.7)', flexShrink: 0 }} />
        )}
      </div>

      {/* Blocks */}
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {blocks.length === 0 ? (
          <div style={{ padding: '8px', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#1e4d6b', letterSpacing: '0.08em' }}>—</div>
        ) : (
          blocks.map(block => {
            const task = block.task_id ? taskMap[block.task_id] : null
            const isDone = task?.status === 'done'
            const load = task?.cognitive_load ?? 1
            const accent = isDone ? 'rgba(0,204,106,0.4)' : LOAD_COLOR[load] ?? '#316a86'

            return (
              <div
                key={block.id}
                style={{
                  padding: '5px 8px',
                  borderBottom: '1px solid rgba(0,186,220,0.04)',
                  borderLeft: `2px solid ${accent}`,
                  marginBottom: 1,
                  opacity: isDone ? 0.5 : 1,
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,186,220,0.03)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#1e4d6b', marginBottom: 2 }}>
                  {block.start_time.slice(0, 5)}
                </div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 300,
                  color: isDone ? '#316a86' : '#9dd4ea',
                  textDecoration: isDone ? 'line-through' : 'none',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  lineHeight: 1.3,
                }}>
                  {task ? task.title : block.calendar_event_id ? 'EXTERNAL' : 'BLOCKED'}
                </div>
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

  const taskMap = Object.fromEntries(tasks.map(t => [t.id, t]))
  const weekDates = Array.from({ length: 7 }, (_, i) => offsetDate(startDate, i))
  const totalBlocks = (schedule?.week ?? []).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 20px 10px', borderBottom: '1px solid rgba(0,186,220,0.08)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 26, letterSpacing: '0.08em', color: '#cde8f5', margin: 0 }}>
            WEEK
          </h1>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>
            {weekOffset === 0 ? 'CURRENT' : formatRange(startDate, endDate)} · {totalBlocks} BLOCKS
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={() => setWeekOffset(n => n - 1)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          >
            ‹
          </button>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em', minWidth: 80, textAlign: 'center' }}>
            {weekOffset === 0 ? 'THIS WEEK' : weekOffset > 0 ? `+${weekOffset}W` : `${weekOffset}W`}
          </span>
          <button
            onClick={() => setWeekOffset(n => n + 1)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
          >
            ›
          </button>
          {weekOffset !== 0 && (
            <button
              onClick={() => setWeekOffset(0)}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em', color: 'rgba(0,186,220,0.5)', background: 'none', border: '1px solid rgba(0,186,220,0.15)', borderRadius: 2, padding: '2px 7px', cursor: 'pointer' }}
            >
              TODAY
            </button>
          )}
        </div>
      </div>

      {/* Load legend */}
      <div style={{ display: 'flex', gap: 16, padding: '6px 20px', borderBottom: '1px solid rgba(0,186,220,0.05)', flexShrink: 0 }}>
        {[['1', 'LIGHT', '#316a86'], ['2', 'MODERATE', '#5fa8c8'], ['3', 'DEEP FOCUS', '#00badc']].map(([l, label, c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 2, height: 10, background: c as string, borderRadius: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#316a86', letterSpacing: '0.1em' }}>{label}</span>
          </div>
        ))}
      </div>

      {/* Grid */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {weekDates.map(date => {
          const ds = isoDate(date)
          const dayBlocks = (schedule?.week ?? []).filter(b => b.date === ds)
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
