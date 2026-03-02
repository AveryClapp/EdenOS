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
        <p className="text-zinc-700 text-xs">No blocks yet. Ask Eden to propose a schedule.</p>
      )}
      {sorted.map((b) => (
        <div key={b.id} className="flex items-start gap-3 py-2 border-b border-zinc-900">
          <span className="text-zinc-600 text-xs w-24 shrink-0">
            {formatTime(b.start_time)} – {formatTime(b.end_time)}
          </span>
          <div className="flex-1">
            <span className="text-zinc-300 text-xs">{b.task_id ?? 'Free time'}</span>
            {b.reason && (
              <p className="text-zinc-700 text-xs mt-0.5">{b.reason}</p>
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
      <div className="flex flex-col w-1/2 border-r border-zinc-800">
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h1 className="text-sm text-zinc-200">plan tomorrow</h1>
            <p className="text-xs text-zinc-600">{today}</p>
          </div>
          <div className="flex gap-2">
            {!locked && blocks.length > 0 && (
              <>
                <button
                  onClick={() => lock()}
                  disabled={locking}
                  className="text-xs text-emerald-500 hover:text-emerald-400 border border-zinc-700 px-2 py-0.5 transition-colors"
                >
                  {locking ? 'locking...' : '[ lock in tomorrow ]'}
                </button>
                <button
                  onClick={() => discard()}
                  className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
                >
                  [ discard ]
                </button>
              </>
            )}
            {locked && (
              <span className="text-xs text-emerald-600">● locked in</span>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {generating && messages.length === 0 && (
            <p className="text-zinc-600 text-xs">generating your schedule...</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
              <div className={`inline-block text-xs px-3 py-2 max-w-[85%] text-left ${
                m.role === 'user'
                  ? 'bg-zinc-800 text-zinc-200'
                  : 'text-zinc-400'
              }`}>
                {m.role === 'eden' && (
                  <span className="text-emerald-600 text-xs block mb-1">eden</span>
                )}
                {m.content}
              </div>
            </div>
          ))}
          {sending && (
            <p className="text-zinc-700 text-xs">eden is thinking...</p>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="px-6 py-4 border-t border-zinc-800 flex gap-2">
          <input
            className="flex-1 bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs px-3 py-2 outline-none focus:border-zinc-600 placeholder-zinc-700"
            placeholder="move writing to morning, drop the reading block..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            disabled={locked}
          />
          <button
            onClick={handleSend}
            disabled={sending || locked || !input.trim()}
            className="text-xs text-zinc-400 hover:text-zinc-200 disabled:text-zinc-800 border border-zinc-800 px-3 py-2 transition-colors"
          >
            send
          </button>
        </div>
      </div>

      {/* Right: Draft Timeline */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs text-zinc-500 tracking-widest uppercase">draft schedule</h2>
          {!locked && (
            <button
              onClick={() => generate()}
              disabled={generating}
              className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
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
