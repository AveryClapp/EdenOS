import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import ReactMarkdown from 'react-markdown'
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
              'flex items-center gap-3 px-3 py-2 rounded-md border text-xs transition-colors ' +
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
                'shrink-0 text-xs font-medium transition-colors ' +
                (approved
                  ? 'text-emerald-400 hover:text-zinc-400'
                  : 'text-zinc-600 hover:text-emerald-500')
              }
            >
              {approved ? 'Approve' : 'Skip'}
            </button>
          </div>
        )
      })}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={() => mutate()}
          disabled={isPending}
          className="text-xs font-medium bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 text-white px-3 py-1.5 rounded-md transition-colors"
        >
          {isPending ? 'Applying…' : 'Apply'}
        </button>
        <button
          onClick={() => {
            setApproval(Object.fromEntries(actions.map((a) => [a.tool_use_id, false])))
            mutate()
          }}
          disabled={isPending}
          className="text-xs text-zinc-500 hover:text-zinc-300 disabled:text-zinc-800 transition-colors"
        >
          Reject all
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
        <span className="w-6 h-6 rounded-full bg-emerald-900 border border-emerald-700 flex items-center justify-center text-emerald-400 text-xs shrink-0 mt-0.5">E</span>
        <div className="flex-1 min-w-0">
          {msg.content && (
            <div className="text-zinc-100 text-sm leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-headings:text-zinc-100 prose-strong:text-zinc-100 prose-code:text-emerald-400 prose-code:before:content-none prose-code:after:content-none prose-ul:my-1 prose-ol:my-1 prose-li:my-0">
              <ReactMarkdown>{msg.content}</ReactMarkdown>
            </div>
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
                reasoning {showReasoning ? '▾' : '▸'}
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
    <div className="py-3 flex justify-end">
      <p className="text-zinc-200 text-sm leading-relaxed bg-zinc-800 px-4 py-2.5 rounded-2xl rounded-tr-sm max-w-lg">
        {msg.content}
      </p>
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

const STORAGE_KEY = 'eden-chat-history'

function loadMessages(): ChatMessage[] {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return INITIAL
}

export default function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>(loadMessages)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages))
    } catch {}
  }, [messages])

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
      <div className="px-6 py-4 border-b border-zinc-800 shrink-0 flex items-center justify-between">
        <span className="text-zinc-100 font-semibold text-sm">Chat</span>
        <button
          onClick={() => { sessionStorage.removeItem(STORAGE_KEY); setMessages(INITIAL) }}
          className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
        >
          Clear
        </button>
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
              <span className="w-6 h-6 rounded-full bg-emerald-900 border border-emerald-700 flex items-center justify-center text-emerald-400 text-xs shrink-0 mt-0.5">E</span>
              <span className="text-zinc-600 text-xs animate-pulse">thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="border-t border-zinc-800 px-6 py-4 shrink-0 flex items-center gap-3">
        <input
          className="flex-1 bg-zinc-900 border border-zinc-800 focus:border-zinc-600 text-zinc-100 text-sm px-4 py-2.5 rounded-lg outline-none placeholder:text-zinc-600 transition-colors"
          placeholder="Ask Eden anything…"
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
      </div>
    </div>
  )
}
