import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { generateWeekPlan, lockWeekPlan, discardPlan } from '../api/plan'
import type { DraftBlock } from '../types'

function getMonday(): string {
  const d = new Date()
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1)
  d.setDate(diff)
  return d.toISOString().split('T')[0]
}

function fmtDay(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'p' : 'a'
  return `${h % 12 || 12}:${m.toString().padStart(2, '0')}${ampm}`
}

function DayColumn({ date, blocks }: { date: string; blocks: DraftBlock[] }) {
  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  return (
    <div className="flex-1 min-w-0 px-3" style={{ borderRight: '1px solid #c8b89a' }}>
      <p className="text-xs pb-2 mb-2" style={{ color: '#7a6550', borderBottom: '1px solid #c8b89a' }}>{fmtDay(date)}</p>
      {sorted.length === 0 && (
        <p className="text-xs" style={{ color: '#a89070' }}>—</p>
      )}
      {sorted.map(b => (
        <div key={b.id} className="mb-2">
          <p className="text-xs" style={{ color: '#7a6550' }}>{fmtTime(b.start_time)}–{fmtTime(b.end_time)}</p>
          <p className="text-xs" style={{ color: '#5a4535' }}>{b.task_id ?? 'free'}</p>
          {b.reason && <p className="text-xs" style={{ color: '#8a7860' }}>{b.reason}</p>}
        </div>
      ))}
    </div>
  )
}

export default function WeekPlanningSession() {
  const qc = useQueryClient()
  const weekStart = getMonday()
  const [days, setDays] = useState<Array<{ date: string; blocks: DraftBlock[]; summary: string }>>([])
  const [locked, setLocked] = useState(false)

  const { mutate: generate, isPending: generating } = useMutation({
    mutationFn: () => generateWeekPlan(weekStart),
    onSuccess: (data) => setDays(data.days),
  })

  const { mutate: lock, isPending: locking } = useMutation({
    mutationFn: () => lockWeekPlan(weekStart),
    onSuccess: () => {
      setLocked(true)
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })

  const { mutate: discard } = useMutation({
    mutationFn: async () => {
      for (const day of days) {
        await discardPlan(day.date)
      }
    },
    onSuccess: () => setDays([]),
  })

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-4 flex items-center justify-between shrink-0" style={{ borderBottom: '1px solid #b0a085' }}>
        <div>
          <h1 className="text-sm" style={{ color: '#1a1208' }}>plan the week</h1>
          <p className="text-xs" style={{ color: '#7a6550' }}>week of {fmtDay(weekStart)}</p>
        </div>
        <div className="flex gap-3">
          {!locked && (
            <>
              <button
                onClick={() => generate()}
                disabled={generating}
                className="text-xs transition-colors"
                style={{ color: generating ? '#a89070' : '#7a6550' }}
                onMouseEnter={e => (e.currentTarget.style.color = '#1a1208')}
                onMouseLeave={e => (e.currentTarget.style.color = generating ? '#a89070' : '#7a6550')}
              >
                {generating ? 'generating...' : days.length > 0 ? '[ regenerate ]' : '[ generate week ]'}
              </button>
              {days.length > 0 && (
                <>
                  <button
                    onClick={() => lock()}
                    disabled={locking}
                    className="text-xs px-2 py-0.5 transition-colors"
                    style={{ color: locking ? '#8a7860' : '#4a8c5c', border: '1px solid #b0a085' }}
                  >
                    {locking ? 'locking...' : '[ lock in week ]'}
                  </button>
                  <button
                    onClick={() => discard()}
                    className="text-xs transition-colors"
                    style={{ color: '#8a7860' }}
                    onMouseEnter={e => (e.currentTarget.style.color = '#5a4535')}
                    onMouseLeave={e => (e.currentTarget.style.color = '#8a7860')}
                  >
                    [ discard ]
                  </button>
                </>
              )}
            </>
          )}
          {locked && <span className="text-xs" style={{ color: '#4a8c5c' }}>● week locked in</span>}
        </div>
      </div>

      <div className="flex-1 overflow-auto px-4 py-4">
        {days.length === 0 && !generating && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs" style={{ color: '#8a7860' }}>click [ generate week ] to propose a schedule</p>
          </div>
        )}
        {generating && days.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs" style={{ color: '#7a6550' }}>generating 7 days...</p>
          </div>
        )}
        {days.length > 0 && (
          <div className="flex h-full">
            {days.map(d => (
              <DayColumn key={d.date} date={d.date} blocks={d.blocks} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
