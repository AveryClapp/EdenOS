import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { sendMessage, executeActions } from '../api/chat'

export default function QuickAdd() {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)

  const { mutate, isPending } = useMutation({
    mutationFn: async (input: string) => {
      const chatResp = await sendMessage(`Add task: ${input}`)
      if (chatResp.proposed_actions.length === 0) {
        return { executed: 0 }
      }
      const actions = chatResp.proposed_actions.map(a => ({
        tool_use_id: a.tool_use_id,
        name: a.name,
        input: a.input as Record<string, unknown>,
        approved: a.name === 'create_task' || a.name === 'create_project',
      }))
      return executeActions(actions)
    },
    onSuccess: (result) => {
      setFeedback(result.executed > 0 ? 'added ✓' : 'nothing to add')
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['projects'] })
      setTimeout(() => {
        setOpen(false)
        setText('')
        setFeedback(null)
      }, 1200)
    },
    onError: () => {
      setFeedback('error — try the chat instead')
    },
  })

  const handleSubmit = () => {
    if (!text.trim() || isPending) return
    mutate(text.trim())
  }

  return (
    <>
      <button
        onClick={() => { setOpen(v => !v); setFeedback(null) }}
        className="fixed bottom-6 right-6 w-8 h-8 bg-zinc-950 border border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 text-base transition-colors flex items-center justify-center z-50"
        title="Quick add task (natural language)"
      >
        +
      </button>
      {open && (
        <div className="fixed bottom-16 right-6 w-80 bg-zinc-950 border border-zinc-800 p-3 z-50 shadow-2xl">
          <p className="text-zinc-600 text-xs mb-2">quick add — describe the task naturally</p>
          <input
            autoFocus
            className="w-full bg-zinc-900 border border-zinc-800 text-zinc-200 text-xs px-2 py-1.5 outline-none focus:border-zinc-600 placeholder-zinc-700"
            placeholder="finish ML paper section 3 by Friday, deep work, ~90min..."
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleSubmit()
              if (e.key === 'Escape') { setOpen(false); setFeedback(null) }
            }}
            disabled={isPending}
          />
          {feedback ? (
            <p className={`text-xs mt-1.5 ${feedback.includes('✓') ? 'text-emerald-600' : 'text-zinc-500'}`}>
              {feedback}
            </p>
          ) : (
            <div className="flex justify-between mt-1.5">
              <button
                onClick={handleSubmit}
                disabled={isPending || !text.trim()}
                className="text-xs text-zinc-500 hover:text-zinc-300 disabled:text-zinc-800 transition-colors"
              >
                {isPending ? 'thinking...' : '[ add ]'}
              </button>
              <button
                onClick={() => { setOpen(false); setText('') }}
                className="text-xs text-zinc-700 hover:text-zinc-500 transition-colors"
              >
                [ cancel ]
              </button>
            </div>
          )}
        </div>
      )}
    </>
  )
}
