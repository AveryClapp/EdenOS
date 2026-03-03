import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { generatePlan, lockPlan, discardPlan } from '../api/plan'
import { sendMessage } from '../api/chat'
import type { DraftBlock, ChatMessage } from '../types'

function formatTime(t: string) {
  // "09:00:00" → "9:00am"
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 || 12
  return `${hour}:${m.toString().padStart(2, '0')}${ampm}`
}

function DraftTimeline({ blocks }: { blocks: DraftBlock[] }) {
  const sorted = [...blocks].sort((a, b) => a.start_time.localeCompare(b.start_time))
  return (
    <div className="space-y-1">
      {sorted.length === 0 && (
        <p className="text-xs" style={{ color: '#8a7860' }}>No blocks yet. Ask Eden to propose a schedule.</p>
      )}
      {sorted.map((b) => (
        <div key={b.id} className="flex items-start gap-3 py-2 border-b" style={{ borderColor: '#c8b89a' }}>
          <span className="text-xs w-24 shrink-0" style={{ color: '#7a6550' }}>
            {formatTime(b.start_time)} – {formatTime(b.end_time)}
          </span>
          <div className="flex-1">
            <span className="text-xs" style={{ color: '#5a4535' }}>{b.task_id ?? 'Free time'}</span>
            {b.reason && (
              <p className="text-xs mt-0.5" style={{ color: '#8a7860' }}>{b.reason}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

export default function PlanningSession() {
  const qc = useQueryClient()
  const today = new Date().toISOString().split('T')[0]
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [blocks, setBlocks] = useState<DraftBlock[]>([])
  const [locked, setLocked] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  const { mutate: generate, isPending: generating } = useMutation({
    mutationFn: () => generatePlan(today),
    onSuccess: (data) => {
      setBlocks(data.blocks)
      setMessages([{
        role: 'eden',
        content: data.summary || 'Here\'s your proposed schedule. What would you like to change?',
      }])
    },
  })

  const { mutate: send, isPending: sending } = useMutation({
    mutationFn: (msg: string) => sendMessage(msg, 'planning', today),
    onSuccess: (data) => {
      setMessages(prev => [...prev, { role: 'eden', content: data.content }])
      generatePlan(today).then(p => setBlocks(p.blocks)).catch(() => {})
    },
  })

  const { mutate: lock, isPending: locking } = useMutation({
    mutationFn: () => lockPlan(today),
    onSuccess: () => {
      setLocked(true)
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })

  const { mutate: discard } = useMutation({
    mutationFn: () => discardPlan(today),
    onSuccess: () => {
      setBlocks([])
      setMessages([])
    },
  })

  useEffect(() => {
    generate()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const msg = input.trim()
    if (!msg || sending) return
    setMessages(prev => [...prev, { role: 'user', content: msg }])
    setInput('')
    send(msg)
  }

  return (
    <div className="flex h-full">
      {/* Left: Chat */}
      <div className="flex flex-col w-1/2" style={{ borderRight: '1px solid #b0a085' }}>
        <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: '1px solid #b0a085' }}>
          <div>
            <h1 className="text-sm" style={{ color: '#1a1208' }}>plan tomorrow</h1>
            <p className="text-xs" style={{ color: '#7a6550' }}>{today}</p>
          </div>
          <div className="flex gap-2">
            {!locked && blocks.length > 0 && (
              <>
                <button
                  onClick={() => lock()}
                  disabled={locking}
                  className="text-xs px-2 py-0.5 transition-colors"
                  style={{ color: locking ? '#8a7860' : '#4a8c5c', border: '1px solid #b0a085' }}
                >
                  {locking ? 'locking...' : '[ lock in tomorrow ]'}
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
            {locked && (
              <span className="text-xs" style={{ color: '#4a8c5c' }}>● locked in</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {generating && messages.length === 0 && (
            <p className="text-xs" style={{ color: '#7a6550' }}>generating your schedule...</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div
                className={`inline-block text-xs px-3 py-2 max-w-[85%] text-left`}
                style={m.role === 'user'
                  ? { background: '#bfad90', color: '#1a1208' }
                  : { color: '#5a4535' }
                }
              >
                {m.role === 'eden' && (
                  <span className="text-xs block mb-1" style={{ color: '#4a8c5c' }}>eden</span>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <p className="text-xs" style={{ color: '#8a7860' }}>eden is thinking...</p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-6 py-4 flex gap-2" style={{ borderTop: '1px solid #b0a085' }}>
          <input
            className="flex-1 text-xs px-3 py-2 outline-none"
            style={{ background: '#d4c4aa', border: '1px solid #b0a085', color: '#1a1208' }}
            placeholder="move writing to morning, drop the reading block..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            onFocus={e => (e.currentTarget.style.borderColor = '#8a7860')}
            onBlur={e => (e.currentTarget.style.borderColor = '#b0a085')}
            disabled={locked}
          />
          <button
            onClick={handleSend}
            disabled={sending || locked || !input.trim()}
            className="text-xs px-3 py-2 transition-colors"
            style={{ color: sending || locked || !input.trim() ? '#a89070' : '#5a4535', border: '1px solid #b0a085' }}
          >
            send
          </button>
        </div>
      </div>

      {/* Right: Draft Timeline */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs tracking-widest uppercase" style={{ color: '#7a6550' }}>draft schedule</h2>
          {!locked && (
            <button
              onClick={() => generate()}
              disabled={generating}
              className="text-xs transition-colors"
              style={{ color: '#8a7860' }}
              onMouseEnter={e => (e.currentTarget.style.color = '#5a4535')}
              onMouseLeave={e => (e.currentTarget.style.color = '#8a7860')}
            >
              {generating ? 'regenerating...' : '[ regenerate ]'}
            </button>
          )}
        </div>
        <DraftTimeline blocks={blocks} />
      </div>
    </div>
  )
}
