import { useState, useRef, useEffect } from 'react'
import { useMutation } from '@tanstack/react-query'
import { sendMessage } from '../api/chat'
import type { ChatMessage } from '../types'

function EdenMessage({ msg }: { msg: ChatMessage }) {
  const [showReasoning, setShowReasoning] = useState(false)

  return (
    <div className="py-4 border-b border-zinc-900">
      <div className="flex gap-3 items-start">
        <span className="text-zinc-600 text-xs shrink-0 pt-0.5 w-12">EDEN ›</span>
        <div className="flex-1 min-w-0">
          <p className="text-zinc-100 text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
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
        { role: 'eden', content: data.content, reasoning: data.reasoning },
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
            <EdenMessage key={i} msg={msg} />
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
