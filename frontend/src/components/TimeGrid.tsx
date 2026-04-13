import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOverride } from '../api/schedule'
import { completeTask } from '../api/tasks'
import type { ScheduleBlock, Task } from '../types'

const START_HOUR = 6
const END_HOUR = 22
const PX_PER_HOUR = 64
const PX_PER_MIN = PX_PER_HOUR / 60
const SLOT_MINS = 15
const GRID_START_MIN = START_HOUR * 60
const GRID_END_MIN = END_HOUR * 60
const GRID_HEIGHT = (END_HOUR - START_HOUR) * PX_PER_HOUR
const LABEL_W = 48

const LOAD_ACCENT: Record<number, string> = {
  1: 'rgba(0,186,220,0.2)',
  2: 'rgba(0,186,220,0.45)',
  3: '#00badc',
}

const LOAD_BG: Record<number, string> = {
  1: 'rgba(0,186,220,0.02)',
  2: 'rgba(0,186,220,0.04)',
  3: 'rgba(0,186,220,0.06)',
}

function timeToMin(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minToTimeStr(m: number): string {
  const h = Math.floor(m / 60)
  const min = m % 60
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

function snapToSlot(min: number): number {
  return Math.round(min / SLOT_MINS) * SLOT_MINS
}

function fmtTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  const ampm = h < 12 ? 'a' : 'p'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

interface DragState { startMin: number; currentMin: number }
interface PendingState { startMin: number; endMin: number }
interface CompletingState { task: Task; blockId: string }

interface TimeGridProps {
  blocks: ScheduleBlock[]
  taskMap: Record<string, Task>
  date: string
}

const inputStyle: React.CSSProperties = {
  fontSize: 11,
  fontFamily: 'var(--font-mono)',
  padding: '3px 6px',
  background: 'rgba(0,186,220,0.04)',
  border: '1px solid rgba(0,186,220,0.12)',
  borderRadius: 2,
  color: '#9dd4ea',
  outline: 'none',
}

export default function TimeGrid({ blocks, taskMap, date }: TimeGridProps) {
  const qc = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)

  const [drag, setDrag] = useState<DragState | null>(null)
  const [pending, setPending] = useState<PendingState | null>(null)
  const [label, setLabel] = useState('')
  const [completing, setCompleting] = useState<CompletingState | null>(null)
  const [mins, setMins] = useState('')
  const [quality, setQuality] = useState('3')
  const [energy, setEnergy] = useState('3')
  const [completeError, setCompleteError] = useState<string | null>(null)

  const { mutate: doCreate, isPending: creating } = useMutation({
    mutationFn: () =>
      createOverride({
        date,
        start_time: minToTimeStr(Math.min(pending!.startMin, pending!.endMin)),
        end_time: minToTimeStr(Math.max(pending!.startMin, pending!.endMin)),
        label: label.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] })
      setPending(null)
      setLabel('')
    },
  })

  const { mutate: doComplete, isPending: isCompleting } = useMutation({
    mutationFn: () =>
      completeTask(completing!.task.id, {
        actual_minutes: Number(mins),
        completion_quality: Number(quality),
        energy_level_at_start: Number(energy),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] })
      qc.invalidateQueries({ queryKey: ['tasks'] })
      setCompleting(null)
      setCompleteError(null)
    },
    onError: (e: Error) => setCompleteError(e.message),
  })

  function getMinFromY(y: number): number {
    const clamped = Math.max(0, Math.min(y, GRID_HEIGHT))
    const raw = GRID_START_MIN + clamped / PX_PER_MIN
    return Math.max(GRID_START_MIN, Math.min(GRID_END_MIN, snapToSlot(raw)))
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (e.button !== 0) return
    const rect = containerRef.current!.getBoundingClientRect()
    const min = getMinFromY(e.clientY - rect.top)
    setDrag({ startMin: min, currentMin: min })
    setPending(null); setLabel(''); setCompleting(null)
    e.preventDefault()
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drag) return
    const rect = containerRef.current!.getBoundingClientRect()
    setDrag(d => d ? { ...d, currentMin: getMinFromY(e.clientY - rect.top) } : null)
  }

  function handleMouseUp() {
    if (!drag) return
    const lo = Math.min(drag.startMin, drag.currentMin)
    const hi = Math.max(drag.startMin, drag.currentMin)
    if (hi - lo >= SLOT_MINS) setPending({ startMin: lo, endMin: hi })
    setDrag(null)
  }

  function handleBlockClick(block: ScheduleBlock, e: React.MouseEvent) {
    e.stopPropagation()
    const task = block.task_id ? taskMap[block.task_id] : null
    if (!task || task.status === 'done') return
    setPending(null)
    setCompleting({ task, blockId: block.id })
    setMins(String(task.estimated_minutes))
    setQuality('3'); setEnergy('3'); setCompleteError(null)
  }

  function blockTopPx(startTime: string): number {
    return (timeToMin(startTime) - GRID_START_MIN) * PX_PER_MIN
  }

  function blockHeightPx(startTime: string, endTime: string): number {
    return Math.max((timeToMin(endTime) - timeToMin(startTime)) * PX_PER_MIN, 20)
  }

  const dragLo = drag ? Math.min(drag.startMin, drag.currentMin) : 0
  const dragHi = drag ? Math.max(drag.startMin, drag.currentMin) : 0
  const dragTopPx = (dragLo - GRID_START_MIN) * PX_PER_MIN
  const dragHeightPx = (dragHi - dragLo) * PX_PER_MIN

  const pendingTopPx = pending ? (pending.startMin - GRID_START_MIN) * PX_PER_MIN : 0
  const pendingHeightPx = pending ? (pending.endMin - pending.startMin) * PX_PER_MIN : 0

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  return (
    <div style={{ display: 'flex', userSelect: 'none' }}>
      {/* Hour labels */}
      <div style={{ width: LABEL_W, flexShrink: 0, position: 'relative', height: GRID_HEIGHT }}>
        {hours.map(h => (
          <div key={h} style={{
            position: 'absolute',
            top: (h - START_HOUR) * PX_PER_HOUR - 7,
            right: 8,
            fontSize: 9,
            fontFamily: 'var(--font-mono)',
            color: h % 6 === 0 ? '#316a86' : '#1e4d6b',
            letterSpacing: '0.04em',
            lineHeight: 1,
          }}>
            {fmtTime(h * 60)}
          </div>
        ))}
      </div>

      {/* Grid */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: 'relative',
          height: GRID_HEIGHT,
          cursor: drag ? 'ns-resize' : 'crosshair',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => { if (drag) handleMouseUp() }}
      >
        {/* Gridlines */}
        {hours.map(h => (
          <div key={h} style={{
            position: 'absolute',
            top: (h - START_HOUR) * PX_PER_HOUR,
            left: 0, right: 0, height: 1,
            background: h % 6 === 0 ? 'rgba(0,186,220,0.08)' : 'rgba(0,186,220,0.03)',
            pointerEvents: 'none',
          }} />
        ))}
        {/* Half-hour ticks */}
        {hours.map(h => (
          <div key={`${h}h`} style={{
            position: 'absolute',
            top: (h - START_HOUR) * PX_PER_HOUR + PX_PER_HOUR / 2,
            left: 0, right: 0, height: 1,
            background: 'rgba(0,186,220,0.02)',
            pointerEvents: 'none',
          }} />
        ))}

        {/* Existing blocks */}
        {blocks.map(block => {
          const task = block.task_id ? taskMap[block.task_id] : null
          const isDone = task?.status === 'done'
          const isFree = !block.task_id
          const isCompletingThis = completing?.blockId === block.id
          const top = blockTopPx(block.start_time)
          const height = blockHeightPx(block.start_time, block.end_time)
          const load = task?.cognitive_load ?? 1

          const accent = isDone
            ? 'rgba(0,204,106,0.4)'
            : isFree
            ? 'rgba(0,186,220,0.12)'
            : isCompletingThis
            ? '#00badc'
            : LOAD_ACCENT[load]

          const bg = isDone
            ? 'rgba(0,204,106,0.04)'
            : isFree
            ? 'rgba(0,186,220,0.02)'
            : isCompletingThis
            ? 'rgba(0,186,220,0.08)'
            : LOAD_BG[load]

          const textColor = isDone ? '#316a86' : isFree ? '#316a86' : '#9dd4ea'

          return (
            <div
              key={block.id}
              onClick={e => handleBlockClick(block, e)}
              style={{
                position: 'absolute',
                top, height,
                left: 2, right: 2,
                background: bg,
                borderLeft: `2px solid ${accent}`,
                borderRadius: '0 2px 2px 0',
                padding: '3px 6px',
                overflow: 'visible',
                cursor: task && !isDone ? 'pointer' : 'default',
                outline: isCompletingThis ? `1px solid rgba(0,186,220,0.3)` : 'none',
                transition: 'background 0.1s',
                zIndex: isCompletingThis ? 10 : 1,
              }}
            >
              <span style={{
                fontSize: 10,
                fontFamily: task ? 'var(--font-sans)' : 'var(--font-mono)',
                fontWeight: 300,
                color: textColor,
                textDecoration: isDone ? 'line-through' : 'none',
                display: 'block',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                lineHeight: 1.4,
              }}>
                {task
                  ? task.title
                  : (block as any).label
                  ? (block as any).label
                  : block.calendar_event_id
                  ? 'EXTERNAL'
                  : 'BLOCKED'}
              </span>

              {/* Completion form */}
              {isCompletingThis && completing && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%', left: 0,
                    marginTop: 4,
                    zIndex: 30,
                    background: '#050e1b',
                    border: '1px solid rgba(0,186,220,0.15)',
                    borderRadius: 2,
                    padding: '8px 12px',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    minWidth: 300,
                    boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
                  }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>MINS</span>
                  <input autoFocus value={mins} onChange={e => setMins(e.target.value)} type="number"
                    style={{ ...inputStyle, width: 50 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>QUALITY</span>
                  <input value={quality} onChange={e => setQuality(e.target.value)} type="number" min={1} max={5}
                    style={{ ...inputStyle, width: 36 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.1em' }}>ENERGY</span>
                  <input value={energy} onChange={e => setEnergy(e.target.value)} type="number" min={1} max={5}
                    style={{ ...inputStyle, width: 36 }} />
                  <button
                    onClick={() => doComplete()}
                    disabled={isCompleting}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: '#00badc', background: 'rgba(0,186,220,0.08)', border: '1px solid rgba(0,186,220,0.25)', borderRadius: 2, padding: '4px 10px', cursor: 'pointer', opacity: isCompleting ? 0.5 : 1 }}
                  >
                    {isCompleting ? '···' : 'DONE'}
                  </button>
                  <button onClick={() => setCompleting(null)}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
                    CANCEL
                  </button>
                  {completeError && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#ff3535', width: '100%' }}>{completeError}</span>}
                </div>
              )}
            </div>
          )
        })}

        {/* Drag preview */}
        {drag && dragHeightPx >= SLOT_MINS * PX_PER_MIN && (
          <>
            <div style={{
              position: 'absolute',
              top: dragTopPx, height: dragHeightPx,
              left: 2, right: 2,
              background: 'rgba(0,186,220,0.05)',
              border: '1px dashed rgba(0,186,220,0.3)',
              borderRadius: 2,
              pointerEvents: 'none',
            }} />
            <div style={{
              position: 'absolute',
              top: dragTopPx + 3, left: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: 'rgba(0,186,220,0.6)',
              letterSpacing: '0.06em',
              pointerEvents: 'none',
            }}>
              {fmtTime(dragLo)} – {fmtTime(dragHi)}
            </div>
          </>
        )}

        {/* Pending block */}
        {pending && (
          <>
            <div style={{
              position: 'absolute',
              top: pendingTopPx, height: pendingHeightPx,
              left: 2, right: 2,
              background: 'rgba(0,186,220,0.06)',
              border: '1px solid rgba(0,186,220,0.3)',
              borderRadius: 2,
              pointerEvents: 'none',
            }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#00badc', padding: '2px 5px', display: 'block', letterSpacing: '0.06em' }}>
                {fmtTime(pending.startMin)} – {fmtTime(pending.endMin)}
              </span>
            </div>

            {/* Naming form */}
            <div
              style={{
                position: 'absolute',
                top: pendingTopPx + pendingHeightPx + 6,
                left: 2, zIndex: 30,
                background: '#050e1b',
                border: '1px solid rgba(0,186,220,0.15)',
                borderRadius: 2,
                padding: '8px 12px',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                boxShadow: '0 4px 24px rgba(0,0,0,0.6)',
              }}
              onMouseDown={e => e.stopPropagation()}
            >
              <input
                autoFocus
                placeholder="NAME THIS BLOCK"
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') doCreate()
                  if (e.key === 'Escape') { setPending(null); setLabel('') }
                }}
                style={{ ...inputStyle, width: 180, letterSpacing: '0.04em' }}
              />
              <button onClick={() => doCreate()} disabled={creating}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: '#00badc', background: 'rgba(0,186,220,0.08)', border: '1px solid rgba(0,186,220,0.25)', borderRadius: 2, padding: '4px 10px', cursor: 'pointer', opacity: creating ? 0.5 : 1 }}>
                {creating ? '···' : 'ADD'}
              </button>
              <button onClick={() => { setPending(null); setLabel('') }}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
                CANCEL
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
