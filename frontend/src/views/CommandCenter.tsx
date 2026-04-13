import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

interface Task {
  id: string
  title: string
  urgency_score: number
  deadline: string | null
  cognitive_load: number
  status: string
  estimated_minutes: number
}

interface Alert {
  type: string
  severity: string
  message: string
}

interface TemporalContext {
  current_time: string
  day_phase: 'morning' | 'afternoon' | 'evening' | 'night'
  day_of_week: string
  date: string
  hours_left_in_day: number
  days_since_last_session: number | null
}

interface WhoopToday {
  recovery_score: number
  recommendation: 'green' | 'yellow' | 'red'
}

interface ContextSnapshot {
  tasks: {
    due_soon: Task[]
    active: Task[]
    backlog: Task[]
    deferred: Task[]
  }
  alerts: Alert[]
  temporal_context: TemporalContext
  whoop_today: WhoopToday | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const LOAD_LABEL: Record<number, string> = { 1: 'LIGHT', 2: 'MOD', 3: 'DEEP' }
const LOAD_COLOR: Record<number, string> = {
  1: 'rgba(0,186,220,0.45)',
  2: 'rgba(0,186,220,0.75)',
  3: '#00badc',
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff3535',
  high: '#ffb300',
  medium: '#316a86',
}

const PHASE_LABEL: Record<string, string> = {
  morning: 'MORNING',
  afternoon: 'AFTERNOON',
  evening: 'EVENING',
  night: 'ONLINE',
}

// ─── HUD Panel wrapper ────────────────────────────────────────────────────────

function HudPanel({
  label,
  children,
  style = {},
  delay = 0,
  indicator,
}: {
  label: string
  children: React.ReactNode
  style?: React.CSSProperties
  delay?: number
  indicator?: 'ok' | 'warn' | 'danger' | 'idle'
}) {
  const indicatorColor = {
    ok: '#00cc6a',
    warn: '#ffb300',
    danger: '#ff3535',
    idle: '#316a86',
  }[indicator ?? 'idle']

  return (
    <div
      className="hud-panel fade-up"
      style={{ animationDelay: `${delay}s`, display: 'flex', flexDirection: 'column', ...style }}
    >
      {/* Panel header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px 5px',
          borderBottom: '1px solid rgba(0,186,220,0.06)',
          flexShrink: 0,
        }}
      >
        {/* Status pip */}
        <span
          style={{
            width: 4, height: 4,
            borderRadius: '50%',
            background: indicatorColor,
            boxShadow: indicator && indicator !== 'idle'
              ? `0 0 5px ${indicatorColor}`
              : 'none',
            animation: indicator && indicator !== 'idle'
              ? 'pulse-dot 2.5s ease-in-out infinite'
              : 'none',
            flexShrink: 0,
          }}
        />
        <span className="hud-label">{label}</span>
      </div>
      <div style={{ flex: 1, padding: '10px 12px', minHeight: 0 }}>
        {children}
      </div>
    </div>
  )
}

// ─── Urgency bar row ──────────────────────────────────────────────────────────

function TaskRow({ task, index }: { task: Task; index: number }) {
  const urgency = task.urgency_score ?? 0
  const barPct = Math.min(100, (urgency / 10) * 100)
  const barColor = urgency > 6 ? '#ff3535' : urgency > 3 ? '#ffb300' : '#00badc'
  const barGlow  = urgency > 6
    ? 'rgba(255,53,53,0.5)'
    : urgency > 3
    ? 'rgba(255,179,0,0.4)'
    : 'rgba(0,186,220,0.4)'

  return (
    <div
      className="fade-up"
      style={{
        animationDelay: `${index * 0.03}s`,
        paddingBottom: 7,
        borderBottom: '1px solid rgba(0,186,220,0.04)',
        marginBottom: 7,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {/* Chevron */}
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8,
          color: 'rgba(0,186,220,0.45)',
          flexShrink: 0,
          letterSpacing: 0,
        }}>
          ►
        </span>
        {/* Title */}
        <span style={{
          flex: 1,
          fontSize: 12,
          fontWeight: 400,
          color: '#cde8f5',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          lineHeight: 1,
        }}>
          {task.title}
        </span>
        {/* Load badge */}
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 9,
          color: LOAD_COLOR[task.cognitive_load] ?? 'rgba(0,186,220,0.3)',
          flexShrink: 0,
          letterSpacing: '0.06em',
        }}>
          {LOAD_LABEL[task.cognitive_load] ?? '—'}
        </span>
        {/* Deadline */}
        {task.deadline && (
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#ffb300',
            flexShrink: 0,
            letterSpacing: '0.05em',
          }}>
            {task.deadline.slice(5, 10)}
          </span>
        )}
      </div>

      {/* Urgency micro-bar */}
      <div style={{ marginTop: 4, marginLeft: 14 }}>
        <div className="micro-bar" style={{ background: 'rgba(0,186,220,0.06)' }}>
          <div
            className="micro-bar-fill"
            style={{
              width: `${barPct}%`,
              background: barColor,
              boxShadow: `0 0 4px ${barGlow}`,
            }}
          />
        </div>
      </div>
    </div>
  )
}

// ─── Recovery arc SVG ─────────────────────────────────────────────────────────

function RecoveryArc({ score, rec }: { score: number; rec: string }) {
  const color = rec === 'green' ? '#00cc6a' : rec === 'yellow' ? '#ffb300' : '#ff3535'
  const r = 28, cx = 36, cy = 36
  const startDeg = -210, sweepDeg = 240
  const toXY = (deg: number) => {
    const rad = (deg - 90) * Math.PI / 180
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) }
  }
  const bgS = toXY(startDeg)
  const bgE = toXY(startDeg + sweepDeg)
  const fgE = toXY(startDeg + sweepDeg * (score / 100))
  const la = sweepDeg > 180 ? 1 : 0
  const fgLa = (sweepDeg * score / 100) > 180 ? 1 : 0

  return (
    <svg width="72" height="72" viewBox="0 0 72 72" style={{ flexShrink: 0 }}>
      <path
        d={`M${bgS.x},${bgS.y} A${r},${r} 0 ${la},1 ${bgE.x},${bgE.y}`}
        fill="none" stroke="rgba(0,186,220,0.08)" strokeWidth="2.5" strokeLinecap="round"
      />
      {score > 0 && (
        <path
          d={`M${bgS.x},${bgS.y} A${r},${r} 0 ${fgLa},1 ${fgE.x},${fgE.y}`}
          fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round"
          style={{ filter: `drop-shadow(0 0 4px ${color})` }}
        />
      )}
      <text
        x="36" y="34"
        textAnchor="middle" dominantBaseline="middle"
        fill={color} fontSize="18"
        fontFamily="var(--font-display)" fontWeight="600"
        style={{ textShadow: `0 0 8px ${color}` }}
      >
        {score}
      </text>
      <text
        x="36" y="48"
        textAnchor="middle" dominantBaseline="middle"
        fill="rgba(0,186,220,0.3)" fontSize="8"
        fontFamily="var(--font-mono)"
      >
        %
      </text>
    </svg>
  )
}

// ─── Main CommandCenter ───────────────────────────────────────────────────────

const fetchContext = (): Promise<ContextSnapshot> =>
  fetch('/api/context').then(r => { if (!r.ok) throw new Error(); return r.json() })

export default function CommandCenter() {
  const [clock, setClock] = useState('')
  const { data: ctx, isError } = useQuery<ContextSnapshot>({
    queryKey: ['context'],
    queryFn: fetchContext,
    staleTime: 60_000,
    refetchInterval: 120_000,
  })

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  if (isError) return (
    <div style={{ padding: 32, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', letterSpacing: '0.1em' }}>
      CONNECTION LOST · RETRYING...
    </div>
  )

  if (!ctx) return (
    <div style={{ padding: 32, display: 'flex', alignItems: 'center', gap: 10, fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', letterSpacing: '0.1em' }}>
      <span style={{ animation: 'pulse-dot 1s infinite', color: '#00badc' }}>◆</span>
      INITIALIZING...
    </div>
  )

  const { temporal_context: t, tasks, alerts, whoop_today } = ctx

  const priorityTasks = [...tasks.due_soon, ...tasks.active]
    .sort((a, b) => b.urgency_score - a.urgency_score)
    .slice(0, 7)

  const taskTotal = tasks.active.length + tasks.due_soon.length + tasks.backlog.length

  return (
    <div
      className="scan-host"
      style={{
        padding: '18px 20px',
        minHeight: '100%',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative',
      }}
    >

      {/* ─── Temporal header ───────────────────────────────────────── */}
      <div
        className="fade-up"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          paddingBottom: 14,
        }}
      >
        {/* Left: greeting + context */}
        <div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 300,
            fontSize: 34,
            letterSpacing: '0.08em',
            color: '#cde8f5',
            lineHeight: 1,
            textShadow: '0 0 40px rgba(0,186,220,0.12)',
          }}>
            {PHASE_LABEL[t.day_phase]}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: '#316a86',
            letterSpacing: '0.12em',
            marginTop: 5,
          }}>
            {t.day_of_week.toUpperCase()} · {t.date} · {t.hours_left_in_day}H REMAINING
            {t.days_since_last_session && t.days_since_last_session > 0 && (
              <span style={{ color: '#ffb300', marginLeft: 8 }}>
                · {t.days_since_last_session}D SINCE LAST SESSION
              </span>
            )}
          </div>
        </div>

        {/* Right: live clock */}
        <div style={{ textAlign: 'right' }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 30,
            color: '#00badc',
            letterSpacing: '0.14em',
            lineHeight: 1,
            textShadow: '0 0 20px rgba(0,186,220,0.35)',
          }}>
            {clock}
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#316a86',
            letterSpacing: '0.16em',
            marginTop: 4,
          }}>
            LOCAL · AUTO-SYNC
          </div>
        </div>
      </div>

      {/* ─── Thin cyan separator ────────────────────────────────────── */}
      <div className="cyber-line fade-in delay-1" />

      {/* ─── Main grid ──────────────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr 260px',
        gridTemplateRows: 'auto auto',
        gap: 12,
        flex: 1,
      }}>

        {/* ─── Priority Queue (spans 2 rows left) ──────────────────── */}
        <HudPanel
          label="Priority Queue"
          indicator={tasks.due_soon.length > 0 ? 'warn' : 'ok'}
          delay={0.08}
          style={{ gridRow: '1 / 3' }}
        >
          {priorityTasks.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', letterSpacing: '0.08em' }}>
              NO ACTIVE ITEMS
            </p>
          ) : (
            <div>
              {priorityTasks.map((task, i) => (
                <TaskRow key={task.id} task={task} index={i} />
              ))}

              {taskTotal > 7 && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: '#316a86',
                  letterSpacing: '0.1em',
                  marginTop: 4,
                }}>
                  +{taskTotal - 7} MORE IN QUEUE
                </div>
              )}
            </div>
          )}
        </HudPanel>

        {/* ─── Alerts ─────────────────────────────────────────────────── */}
        <HudPanel
          label="Active Alerts"
          indicator={
            alerts.some(a => a.severity === 'critical') ? 'danger'
            : alerts.some(a => a.severity === 'high') ? 'warn'
            : alerts.length > 0 ? 'ok'
            : 'idle'
          }
          delay={0.14}
        >
          {alerts.length === 0 ? (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', letterSpacing: '0.08em' }}>
              NOMINAL · NO FLAGS
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {alerts.slice(0, 3).map((a, i) => (
                <div
                  key={i}
                  className="fade-up"
                  style={{ animationDelay: `${i * 0.04}s`, display: 'flex', gap: 7, alignItems: 'flex-start' }}
                >
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: SEV_COLOR[a.severity] ?? '#316a86',
                    flexShrink: 0,
                    marginTop: 1,
                  }}>
                    ◈
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 300, color: '#5fa8c8', lineHeight: 1.45 }}>
                    {a.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </HudPanel>

        {/* ─── Biometric ──────────────────────────────────────────────── */}
        <HudPanel
          label="Biometric"
          indicator={
            whoop_today?.recommendation === 'green' ? 'ok'
            : whoop_today?.recommendation === 'yellow' ? 'warn'
            : whoop_today?.recommendation === 'red' ? 'danger'
            : 'idle'
          }
          delay={0.18}
        >
          {whoop_today ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <RecoveryArc score={whoop_today.recovery_score} rec={whoop_today.recommendation} />
              <div>
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 9,
                  color: '#316a86',
                  letterSpacing: '0.12em',
                  marginBottom: 5,
                }}>
                  RECOVERY
                </div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 400,
                  color: whoop_today.recommendation === 'green' ? '#00cc6a'
                    : whoop_today.recommendation === 'yellow' ? '#ffb300'
                    : '#ff3535',
                  lineHeight: 1.4,
                  letterSpacing: '0.02em',
                }}>
                  {whoop_today.recommendation === 'green'
                    ? 'Cleared for full output'
                    : whoop_today.recommendation === 'yellow'
                    ? 'Moderate load only'
                    : 'Rest recommended'}
                </div>
              </div>
            </div>
          ) : (
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', letterSpacing: '0.08em' }}>
              NO BIOMETRIC LINK
            </p>
          )}
        </HudPanel>

        {/* ─── Task Load Distribution ──────────────────────────────────── */}
        <HudPanel
          label="Load Distribution"
          indicator="idle"
          delay={0.22}
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {[
              { label: 'DUE SOON', value: tasks.due_soon.length,  cap: 8,  color: '#ffb300' },
              { label: 'ACTIVE',   value: tasks.active.length,    cap: 12, color: '#00badc' },
              { label: 'BACKLOG',  value: tasks.backlog.length,   cap: 40, color: '#316a86' },
              { label: 'DEFERRED', value: tasks.deferred.length,  cap: 10, color: '#316a86' },
            ].map(({ label, value, cap, color }, i) => (
              <div key={label} className="fade-up" style={{ animationDelay: `${i * 0.04}s` }}>
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: 3,
                  alignItems: 'center',
                }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 9,
                    color: '#316a86',
                    letterSpacing: '0.1em',
                  }}>
                    {label}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color }}>
                    {String(value).padStart(2, '0')}
                  </span>
                </div>
                <div className="micro-bar" style={{ background: 'rgba(0,186,220,0.06)' }}>
                  <div
                    className="micro-bar-fill"
                    style={{
                      width: `${Math.min(100, (value / cap) * 100)}%`,
                      background: color,
                      boxShadow: value > 0 ? `0 0 4px ${color}66` : 'none',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </HudPanel>

        {/* ─── Finance (Phase II) ──────────────────────────────────────── */}
        <HudPanel label="Finance" indicator="idle" delay={0.26}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#316a86',
            letterSpacing: '0.12em',
            lineHeight: 2,
          }}>
            <div>NET WORTH&nbsp;&nbsp;&nbsp;&nbsp;· · ·</div>
            <div>PORTFOLIO&nbsp;&nbsp;&nbsp;&nbsp;· · ·</div>
            <div>CASH RUNWAY&nbsp;&nbsp;· · ·</div>
            <div style={{ marginTop: 6, color: '#0f2438', fontSize: 8 }}>
              PHASE II · MANIFOLD INTEGRATION PENDING
            </div>
          </div>
        </HudPanel>

      </div>
    </div>
  )
}
