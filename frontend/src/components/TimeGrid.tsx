import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { createOverride } from '../api/schedule'
import { completeTask } from '../api/tasks'
import type { ScheduleBlock, Task } from '../types'

// Grid configuration
const START_HOUR = 6   // 6 AM
const END_HOUR = 22    // 10 PM
const PX_PER_HOUR = 64
const PX_PER_MIN = PX_PER_HOUR / 60
const SLOT_MINS = 15
const GRID_START_MIN = START_HOUR * 60
const GRID_END_MIN = END_HOUR * 60
const GRID_HEIGHT = (END_HOUR - START_HOUR) * PX_PER_HOUR
const LABEL_W = 48    // px width of hour label column

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
  const ampm = h < 12 ? 'am' : 'pm'
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

interface DragState { startMin: number; currentMin: number }
interface PendingState { startMin: number; endMin: number }
interface CompletingState { task: Task; blockId: string }

interface TimeGridProps {
  blocks: ScheduleBlock[]
  taskMap: Record<string, Task>
  date: string  // "YYYY-MM-DD"
}

export default function TimeGrid({ blocks, taskMap, date }: TimeGridProps) {
  const qc = useQueryClient()
  const containerRef = useRef<HTMLDivElement>(null)

  // Drag-to-create state
  const [drag, setDrag] = useState<DragState | null>(null)
  const [pending, setPending] = useState<PendingState | null>(null)
  const [label, setLabel] = useState('')

  // Task completion state
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
    setPending(null)
    setLabel('')
    setCompleting(null)
    e.preventDefault()
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!drag) return
    const rect = containerRef.current!.getBoundingClientRect()
    const min = getMinFromY(e.clientY - rect.top)
    setDrag(d => d ? { ...d, currentMin: min } : null)
  }

  function handleMouseUp() {
    if (!drag) return
    const lo = Math.min(drag.startMin, drag.currentMin)
    const hi = Math.max(drag.startMin, drag.currentMin)
    if (hi - lo >= SLOT_MINS) {
      setPending({ startMin: lo, endMin: hi })
    }
    setDrag(null)
  }

  function handleBlockClick(block: ScheduleBlock, e: React.MouseEvent) {
    e.stopPropagation()
    const task = block.task_id ? taskMap[block.task_id] : null
    if (!task || task.status === 'done') return
    setPending(null)
    setCompleting({ task, blockId: block.id })
    setMins(String(task.estimated_minutes))
    setQuality('3')
    setEnergy('3')
    setCompleteError(null)
  }

  function blockTopPx(startTime: string): number {
    return (timeToMin(startTime) - GRID_START_MIN) * PX_PER_MIN
  }

  function blockHeightPx(startTime: string, endTime: string): number {
    return Math.max((timeToMin(endTime) - timeToMin(startTime)) * PX_PER_MIN, 20)
  }

  // Drag preview geometry
  const dragLo = drag ? Math.min(drag.startMin, drag.currentMin) : 0
  const dragHi = drag ? Math.max(drag.startMin, drag.currentMin) : 0
  const dragTopPx = (dragLo - GRID_START_MIN) * PX_PER_MIN
  const dragHeightPx = (dragHi - dragLo) * PX_PER_MIN

  // Pending block geometry
  const pendingTopPx = pending ? (pending.startMin - GRID_START_MIN) * PX_PER_MIN : 0
  const pendingHeightPx = pending ? (pending.endMin - pending.startMin) * PX_PER_MIN : 0

  const hours = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

  return (
    <div style={{ display: 'flex', userSelect: 'none' }}>
      {/* Hour label column */}
      <div style={{ width: LABEL_W, flexShrink: 0, position: 'relative', height: GRID_HEIGHT }}>
        {hours.map(h => (
          <div
            key={h}
            style={{
              position: 'absolute',
              top: (h - START_HOUR) * PX_PER_HOUR - 7,
              right: 8,
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: '#3f3f46',
              lineHeight: 1,
            }}
          >
            {fmtTime(h * 60)}
          </div>
        ))}
      </div>

      {/* Draggable grid area */}
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
        {/* Hour gridlines */}
        {hours.map(h => (
          <div
            key={h}
            style={{
              position: 'absolute',
              top: (h - START_HOUR) * PX_PER_HOUR,
              left: 0, right: 0, height: 1,
              background: h % 2 === 0 ? '#27272a' : '#1f1f22',
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Half-hour marks */}
        {hours.map(h => (
          <div
            key={`${h}h`}
            style={{
              position: 'absolute',
              top: (h - START_HOUR) * PX_PER_HOUR + PX_PER_HOUR / 2,
              left: 0, right: 0, height: 1,
              background: '#18181b',
              pointerEvents: 'none',
            }}
          />
        ))}

        {/* Existing blocks */}
        {blocks.map(block => {
          const task = block.task_id ? taskMap[block.task_id] : null
          const isDone = task?.status === 'done'
          const isFree = !block.task_id
          const isCompletingThis = completing?.blockId === block.id
          const top = blockTopPx(block.start_time)
          const height = blockHeightPx(block.start_time, block.end_time)

          const bg = isDone
            ? '#0d2d1a'
            : isFree
            ? '#18181b'
            : isCompletingThis
            ? '#1c1407'
            : '#111113'

          const accent = isDone ? '#16a34a' : isFree ? '#3f3f46' : '#b45309'
          const textColor = isDone ? '#16a34a' : isFree ? '#71717a' : '#a1a1aa'

          return (
            <div
              key={block.id}
              onClick={(e) => handleBlockClick(block, e)}
              style={{
                position: 'absolute',
                top,
                height,
                left: 2,
                right: 2,
                background: bg,
                borderLeft: `2px solid ${accent}`,
                borderRadius: '0 4px 4px 0',
                padding: '3px 6px',
                overflow: 'visible',
                cursor: task && !isDone ? 'pointer' : 'default',
                outline: isCompletingThis ? `1px solid ${accent}` : 'none',
                transition: 'background 0.1s',
                zIndex: isCompletingThis ? 10 : 1,
              }}
            >
              <span style={{
                fontSize: 10,
                fontFamily: 'var(--font-mono)',
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
                  : block.label
                  ? block.label
                  : block.calendar_event_id
                  ? 'External'
                  : 'Blocked'}
              </span>

              {/* Inline completion form */}
              {isCompletingThis && completing && (
                <div
                  style={{
                    position: 'absolute',
                    top: '100%',
                    left: 0,
                    marginTop: 4,
                    zIndex: 30,
                    background: '#18181b',
                    border: '1px solid #27272a',
                    borderRadius: 8,
                    padding: '8px 12px',
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    minWidth: 280,
                    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
                  }}
                  onMouseDown={e => e.stopPropagation()}
                >
                  <span style={{ fontSize: 11, color: '#71717a' }}>mins</span>
                  <input
                    autoFocus
                    value={mins}
                    onChange={e => setMins(e.target.value)}
                    type="number"
                    style={{ width: 50, fontSize: 11, padding: '3px 6px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#f4f4f5', outline: 'none' }}
                  />
                  <span style={{ fontSize: 11, color: '#71717a' }}>quality</span>
                  <input
                    value={quality}
                    onChange={e => setQuality(e.target.value)}
                    type="number" min={1} max={5}
                    style={{ width: 36, fontSize: 11, padding: '3px 6px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#f4f4f5', outline: 'none' }}
                  />
                  <span style={{ fontSize: 11, color: '#71717a' }}>energy</span>
                  <input
                    value={energy}
                    onChange={e => setEnergy(e.target.value)}
                    type="number" min={1} max={5}
                    style={{ width: 36, fontSize: 11, padding: '3px 6px', background: '#27272a', border: '1px solid #3f3f46', borderRadius: 4, color: '#f4f4f5', outline: 'none' }}
                  />
                  <button
                    onClick={() => doComplete()}
                    disabled={isCompleting}
                    style={{ background: isCompleting ? '#3f3f46' : '#7c2d12', color: '#fbbf24', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 500, padding: '4px 12px', cursor: 'pointer' }}
                  >
                    {isCompleting ? '…' : 'Done'}
                  </button>
                  <button
                    onClick={() => setCompleting(null)}
                    style={{ fontSize: 11, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer' }}
                  >
                    Cancel
                  </button>
                  {completeError && (
                    <span style={{ fontSize: 11, color: '#ef4444', width: '100%' }}>{completeError}</span>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* Drag preview */}
        {drag && dragHeightPx >= SLOT_MINS * PX_PER_MIN && (
          <>
            <div
              style={{
                position: 'absolute',
                top: dragTopPx,
                height: dragHeightPx,
                left: 2, right: 2,
                background: 'rgba(180, 83, 9, 0.1)',
                border: '1px dashed #b45309',
                borderRadius: 4,
                pointerEvents: 'none',
              }}
            />
            <div style={{
              position: 'absolute',
              top: dragTopPx + 3,
              left: 8,
              fontSize: 9,
              color: '#b45309',
              fontFamily: 'var(--font-mono)',
              pointerEvents: 'none',
            }}>
              {fmtTime(dragLo)} – {fmtTime(dragHi)}
            </div>
          </>
        )}

        {/* Pending block (awaiting name) */}
        {pending && (
          <>
            <div
              style={{
                position: 'absolute',
                top: pendingTopPx,
                height: pendingHeightPx,
                left: 2, right: 2,
                background: 'rgba(180, 83, 9, 0.18)',
                border: '1px solid #b45309',
                borderRadius: 4,
                pointerEvents: 'none',
              }}
            >
              <span style={{
                fontSize: 9,
                color: '#fbbf24',
                fontFamily: 'var(--font-mono)',
                padding: '2px 5px',
                display: 'block',
              }}>
                {fmtTime(pending.startMin)} – {fmtTime(pending.endMin)}
              </span>
            </div>

            {/* Naming form */}
            <div
              style={{
                position: 'absolute',
                top: pendingTopPx + pendingHeightPx + 6,
                left: 2,
                zIndex: 30,
                background: '#18181b',
                border: '1px solid #27272a',
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
              }}
              onMouseDown={e => e.stopPropagation()}
            >
              <input
                autoFocus
                placeholder="Name this block…"
                value={label}
                onChange={e => setLabel(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') doCreate()
                  if (e.key === 'Escape') { setPending(null); setLabel('') }
                }}
                style={{
                  width: 170,
                  fontSize: 12,
                  padding: '3px 8px',
                  background: '#27272a',
                  border: '1px solid #3f3f46',
                  borderRadius: 6,
                  color: '#f4f4f5',
                  outline: 'none',
                }}
              />
              <button
                onClick={() => doCreate()}
                disabled={creating}
                style={{ background: creating ? '#3f3f46' : '#7c2d12', color: '#fbbf24', border: 'none', borderRadius: 6, fontSize: 11, fontWeight: 500, padding: '4px 12px', cursor: 'pointer' }}
              >
                {creating ? '…' : 'Add'}
              </button>
              <button
                onClick={() => { setPending(null); setLabel('') }}
                style={{ fontSize: 11, color: '#71717a', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
