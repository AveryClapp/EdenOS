import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSchedule } from '../api/schedule'
import { listTasks } from '../api/tasks'
import { listGoals } from '../api/goals'
import type { ScheduleBlock, Task, Goal } from '../types'

const DAYS_OF_WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
                     'July', 'August', 'September', 'October', 'November', 'December']

const LOAD_COLOR: Record<number, string> = {
  1: 'rgba(49,106,134,0.7)',
  2: 'rgba(95,168,200,0.7)',
  3: 'rgba(0,186,220,0.8)',
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Build a 6-week calendar grid starting from the Monday before/on the 1st
function buildCalendarGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  // Day of week: 0=Sun, adjust so Mon=0
  const startDow = (first.getDay() + 6) % 7
  const start = new Date(first)
  start.setDate(1 - startDow)
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start)
    d.setDate(start.getDate() + i)
    return d
  })
}

interface DayCellProps {
  date: Date
  isCurrentMonth: boolean
  isToday: boolean
  blocks: ScheduleBlock[]
  deadlines: Task[]
  milestones: Goal[]
  taskMap: Record<string, Task>
}

function DayCell({ date, isCurrentMonth, isToday, blocks, deadlines, milestones, taskMap }: DayCellProps) {
  const deepBlocks = blocks.filter(b => {
    const t = b.task_id ? taskMap[b.task_id] : null
    return t && t.cognitive_load === 3
  })
  const totalBlocks = blocks.length

  return (
    <div style={{
      minHeight: 76,
      padding: '5px 6px',
      borderRight: '1px solid rgba(0,186,220,0.05)',
      borderBottom: '1px solid rgba(0,186,220,0.05)',
      background: isToday
        ? 'rgba(0,186,220,0.04)'
        : isCurrentMonth ? 'transparent' : 'rgba(0,0,0,0.1)',
      position: 'relative',
      overflow: 'hidden',
    }}>
      {/* Date number */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 4,
      }}>
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: isToday ? 11 : 10,
          fontWeight: isToday ? 600 : 400,
          color: isToday ? '#00badc' : isCurrentMonth ? '#527e96' : '#1e3a52',
          ...(isToday && {
            background: 'rgba(0,186,220,0.12)',
            border: '1px solid rgba(0,186,220,0.3)',
            borderRadius: 2,
            padding: '1px 4px',
          }),
        }}>
          {date.getDate()}
        </span>
        {totalBlocks > 0 && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            color: 'rgba(0,186,220,0.35)',
            letterSpacing: '0.04em',
          }}>
            {totalBlocks}
          </span>
        )}
      </div>

      {/* Milestone markers */}
      {milestones.map(g => (
        <div key={g.id} style={{
          fontSize: 9,
          fontWeight: 300,
          color: '#b08fff',
          background: 'rgba(160,120,255,0.08)',
          border: '1px solid rgba(160,120,255,0.2)',
          borderRadius: 2,
          padding: '1px 4px',
          marginBottom: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.04em',
        }}>
          ◈ {g.title}
        </div>
      ))}

      {/* Deadline markers */}
      {deadlines.slice(0, 2).map(t => (
        <div key={t.id} style={{
          fontSize: 9,
          fontWeight: 300,
          color: '#e67e22',
          background: 'rgba(230,126,34,0.06)',
          border: '1px solid rgba(230,126,34,0.18)',
          borderRadius: 2,
          padding: '1px 4px',
          marginBottom: 2,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontFamily: 'var(--font-sans)',
        }}>
          ⚑ {t.title}
        </div>
      ))}
      {deadlines.length > 2 && (
        <div style={{ fontSize: 8, color: '#e67e22', fontFamily: 'var(--font-mono)', opacity: 0.7 }}>
          +{deadlines.length - 2} more
        </div>
      )}

      {/* Block load bars */}
      {totalBlocks > 0 && (
        <div style={{
          position: 'absolute',
          bottom: 3,
          left: 6,
          right: 6,
          display: 'flex',
          gap: 2,
          alignItems: 'flex-end',
        }}>
          {blocks.slice(0, 8).map((b, i) => {
            const t = b.task_id ? taskMap[b.task_id] : null
            const load = t?.cognitive_load ?? 1
            return (
              <div key={i} style={{
                flex: 1,
                height: load === 3 ? 6 : load === 2 ? 4 : 3,
                background: LOAD_COLOR[load],
                borderRadius: 1,
                maxWidth: 8,
              }} />
            )
          })}
          {totalBlocks > 8 && (
            <div style={{
              width: 6, height: 3,
              background: 'rgba(0,186,220,0.2)',
              borderRadius: 1,
            }} />
          )}
        </div>
      )}

      {/* Deep work indicator */}
      {deepBlocks.length > 0 && (
        <div style={{
          position: 'absolute',
          top: 3,
          right: 4,
          width: 4,
          height: 4,
          borderRadius: '50%',
          background: '#00badc',
          boxShadow: '0 0 5px rgba(0,186,220,0.6)',
        }} />
      )}
    </div>
  )
}

export default function Month() {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth())

  const calendarDays = useMemo(() => buildCalendarGrid(year, month), [year, month])
  const rangeStart = isoDate(calendarDays[0])
  const todayStr = isoDate(today)

  const { data: schedule } = useQuery({
    queryKey: ['schedule', rangeStart, 42],
    queryFn: () => getSchedule(rangeStart, 42),
    staleTime: 60_000,
  })

  const { data: tasks = [] } = useQuery<Task[]>({
    queryKey: ['tasks'],
    queryFn: listTasks,
  })

  const { data: goals = [] } = useQuery<Goal[]>({
    queryKey: ['goals'],
    queryFn: listGoals,
  })

  const taskMap = useMemo(() =>
    Object.fromEntries(tasks.map(t => [t.id, t])),
    [tasks]
  )

  // Index blocks by date
  const blocksByDate = useMemo(() => {
    const map: Record<string, ScheduleBlock[]> = {}
    for (const b of schedule?.week ?? []) {
      if (!map[b.date]) map[b.date] = []
      map[b.date].push(b)
    }
    return map
  }, [schedule])

  // Index task deadlines by date
  const deadlinesByDate = useMemo(() => {
    const map: Record<string, Task[]> = {}
    for (const t of tasks) {
      if (!t.deadline || t.status === 'done' || t.status === 'dropped') continue
      const d = t.deadline.slice(0, 10)
      if (!map[d]) map[d] = []
      map[d].push(t)
    }
    return map
  }, [tasks])

  // Index goal milestones (mid-tier with target_date) by date
  const milestonesByDate = useMemo(() => {
    const map: Record<string, Goal[]> = {}
    for (const g of goals) {
      if (g.tier !== 'mid' || !g.target_date || g.status !== 'active') continue
      const d = g.target_date.slice(0, 10)
      if (!map[d]) map[d] = []
      map[d].push(g)
    }
    return map
  }, [goals])

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }
  function goToday() { setYear(today.getFullYear()); setMonth(today.getMonth()) }

  const isCurrentMonth = year === today.getFullYear() && month === today.getMonth()

  // Stats for header
  const monthDays = calendarDays.filter(d => d.getMonth() === month)
  const totalBlocksMonth = monthDays.reduce((s, d) => s + (blocksByDate[isoDate(d)]?.length ?? 0), 0)
  const totalDeadlinesMonth = monthDays.reduce((s, d) => s + (deadlinesByDate[isoDate(d)]?.length ?? 0), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
        padding: '14px 20px 10px',
        borderBottom: '1px solid rgba(0,186,220,0.08)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <h1 style={{
            fontFamily: 'var(--font-display)', fontWeight: 300, fontSize: 26,
            letterSpacing: '0.08em', color: '#cde8f5', margin: 0,
          }}>
            {MONTH_NAMES[month].toUpperCase()}
          </h1>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>
            {year} · {totalBlocksMonth} BLOCKS · {totalDeadlinesMonth} DEADLINES
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={prevMonth} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>‹</button>
          {!isCurrentMonth && (
            <button onClick={goToday} style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
              color: 'rgba(0,186,220,0.5)', background: 'none',
              border: '1px solid rgba(0,186,220,0.15)', borderRadius: 2,
              padding: '2px 7px', cursor: 'pointer',
            }}>
              TODAY
            </button>
          )}
          <button onClick={nextMonth} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>›</button>
        </div>
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 16, padding: '6px 20px', borderBottom: '1px solid rgba(0,186,220,0.05)', flexShrink: 0, flexWrap: 'wrap' }}>
        {[['LIGHT', LOAD_COLOR[1]], ['MODERATE', LOAD_COLOR[2]], ['DEEP FOCUS', LOAD_COLOR[3]]].map(([l, c]) => (
          <div key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 8, height: 3, background: c as string, borderRadius: 1 }} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#316a86', letterSpacing: '0.08em' }}>{l}</span>
          </div>
        ))}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 3, background: 'rgba(160,120,255,0.5)', borderRadius: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#316a86', letterSpacing: '0.08em' }}>MILESTONE</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{ width: 8, height: 3, background: 'rgba(230,126,34,0.5)', borderRadius: 1 }} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 8, color: '#316a86', letterSpacing: '0.08em' }}>DEADLINE</span>
        </div>
      </div>

      {/* Day-of-week header */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        borderBottom: '1px solid rgba(0,186,220,0.08)',
        flexShrink: 0,
      }}>
        {DAYS_OF_WEEK.map(d => (
          <div key={d} style={{
            padding: '5px 6px',
            fontFamily: 'var(--font-mono)',
            fontSize: 8,
            letterSpacing: '0.12em',
            color: '#2c526a',
            textAlign: 'center',
            borderRight: '1px solid rgba(0,186,220,0.05)',
          }}>
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div style={{
        flex: 1,
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gridTemplateRows: 'repeat(6, 1fr)',
        overflow: 'hidden',
        borderTop: '1px solid rgba(0,186,220,0.05)',
      }}>
        {calendarDays.map((d, i) => {
          const ds = isoDate(d)
          return (
            <DayCell
              key={i}
              date={d}
              isCurrentMonth={d.getMonth() === month}
              isToday={ds === todayStr}
              blocks={blocksByDate[ds] ?? []}
              deadlines={deadlinesByDate[ds] ?? []}
              milestones={milestonesByDate[ds] ?? []}
              taskMap={taskMap}
            />
          )
        })}
      </div>
    </div>
  )
}
