import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessage, executeActions } from '../api/chat'
import type { ChatMessage, ProposedAction } from '../types'

// --- ActionCards ---

type ApprovalState = Record<string, boolean>  // tool_use_id → approved

function ActionCards({ actions, messageIndex }: { actions: ProposedAction[]; messageIndex: number }) {
  const qc = useQueryClient()
  const [approval, setApproval] = useState<ApprovalState>(() =>
    Object.fromEntries(actions.map((a) => [a.tool_use_id, true]))
  )
  const [submitted, setSubmitted] = useState(false)
  const [result, setResult] = useState<{ executed: number; skipped: number } | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: () =>
      executeActions(
        actions.map((a) => ({
          tool_use_id: a.tool_use_id,
          name: a.name,
          input: a.input,
          approved: approval[a.tool_use_id] ?? false,
        }))
      ),
    onSuccess: (data) => {
      setSubmitted(true)
      setResult(data)
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['schedule'] })
    },
  })

  if (submitted && result) {
    const parts = []
    if (result.executed > 0) parts.push(`${result.executed} applied`)
    if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
    return (
      <p className="mt-2 text-zinc-600 text-xs">[{parts.join(', ')}]</p>
    )
  }

  return (
    <div className="mt-3 space-y-1.5">
      {actions.map((action) => {
        const approved = approval[action.tool_use_id] ?? true
        return (
          <div
            key={action.tool_use_id}
            className={
              'flex items-center gap-3 px-3 py-2 border text-xs transition-colors ' +
              (approved
                ? 'border-zinc-700 bg-zinc-900 text-zinc-200'
                : 'border-zinc-800 bg-transparent text-zinc-600 line-through')
            }
          >
            <span className="flex-1 font-mono">{action.description}</span>
            <button
              onClick={() =>
                setApproval((prev) => ({ ...prev, [action.tool_use_id]: !prev[action.tool_use_id] }))
              }
              className={
                'shrink-0 text-xs transition-colors ' +
                (approved
                  ? 'text-emerald-500 hover:text-zinc-400'
                  : 'text-zinc-600 hover:text-emerald-500')
              }
            >
              {approved ? '[ ✓ approve ]' : '[ skip ]'}
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => mutate()}
          disabled={isPending}
          className="text-xs text-emerald-400 hover:text-emerald-300 disabled:text-zinc-600 border border-zinc-700 disabled:border-zinc-800 px-2 py-0.5 transition-colors"
        >
          {isPending ? 'applying...' : '[ apply ]'}
        </button>
        <button
          onClick={() => {
            setApproval(Object.fromEntries(actions.map((a) => [a.tool_use_id, false])))
            mutate()
          }}
          disabled={isPending}
          className="text-xs text-zinc-600 hover:text-zinc-400 disabled:text-zinc-800 transition-colors"
        >
          reject all
        </button>
      </div>
    </div>
  )
}

// --- Message components ---

function EdenMessage({ msg, index }: { msg: ChatMessage; index: number }) {
  const [showReasoning, setShowReasoning] = useState(false)

  return (
    <div className="py-4 border-b border-zinc-900">
      <div className="flex gap-3 items-start">
        <span className="text-zinc-600 text-xs shrink-0 pt-0.5 w-12">EDEN ›</span>
        <div className="flex-1 min-w-0">
          {msg.content && (
            <p className="text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
          )}
          {msg.proposed_actions && msg.proposed_actions.length > 0 && (
            <ActionCards actions={msg.proposed_actions} messageIndex={index} />
          )}
          {msg.reasoning && (
            <div className="mt-2">
              <button
                onClick={() => setShowReasoning((v) => !v)}
                className="text-zinc-600 text-xs hover:text-zinc-400 transition-colors"
              >
                [reasoning {showReasoning ? '▾' : '▸'}]
              </button>
              {showReasoning && (
                <p className="mt-1.5 text-zinc-500 text-xs italic leading-relaxed whitespace-pre-wrap pl-3 border-l border-zinc-800">
                  {msg.reasoning}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function UserMessage({ msg }: { msg: ChatMessage }) {
  return (
    <div className="py-4 border-b border-zinc-900">
      <div className="flex gap-3 items-start justify-end">
        <p className="text-zinc-300 text-sm leading-relaxed whitespace-pre-wrap bg-zinc-800 px-3 py-1.5 max-w-xl">
          {msg.content}
        </p>
        <span className="text-zinc-600 text-xs shrink-0 pt-0.5 w-12 text-right">YOU ›</span>
      </div>
    </div>
  )
}

const INITIAL: ChatMessage[] = [
  {
    role: 'eden',
    content:
      'Ready. Ask me what to work on, why something is scheduled, or what you should focus on.',
    reasoning: '',
  },
]

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>(INITIAL)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: (msg: string) => sendMessage(msg),
    onSuccess: (data) => {
      setMessages((prev) => [
        ...prev,
        {
          role: 'eden',
          content: data.content,
          reasoning: data.reasoning,
          proposed_actions: data.proposed_actions,
        },
      ])
    },
    onError: () => {
      setMessages((prev) => [
        ...prev,
        { role: 'eden', content: '[error: could not reach Eden]', reasoning: '' },
      ])
    },
  })

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isPending])

  function submit() {
    const text = input.trim()
    if (!text || isPending) return
    setMessages((prev) => [...prev, { role: 'user', content: text }])
    setInput('')
    mutate(text)
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 py-3 border-b border-zinc-800 text-sm tracking-widest text-zinc-100 shrink-0">
        CHAT
      </div>

      <div className="flex-1 overflow-y-auto px-6">
        {messages.map((msg, i) =>
          msg.role === 'eden' ? (
            <EdenMessage key={i} msg={msg} index={i} />
          ) : (
            <UserMessage key={i} msg={msg} />
          ),
        )}
        {isPending && (
          <div className="py-4 border-b border-zinc-900">
            <div className="flex gap-3 items-start">
              <span className="text-zinc-600 text-xs shrink-0 pt-0.5 w-12">EDEN ›</span>
              <span className="text-zinc-600 text-xs animate-pulse">thinking...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 px-6 py-3 shrink-0 flex items-center gap-3">
        <span className="text-zinc-600 text-xs w-12">YOU ›</span>
        <input
          className="flex-1 bg-transparent text-zinc-100 text-sm font-mono outline-none placeholder:text-zinc-700"
          placeholder="ask eden..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          disabled={isPending}
          autoFocus
        />
        <span className="text-zinc-700 text-xs">↵</span>
      </div>
    </div>
  )
}
