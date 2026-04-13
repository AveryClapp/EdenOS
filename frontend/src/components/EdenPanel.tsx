import { useState, useEffect, useRef } from 'react'

interface Message {
  role: 'eden' | 'user'
  content: string
  reasoning?: string
}

const SESSION_OPEN_TOKEN = '__session_open__'

export default function EdenPanel() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    sendMessage(SESSION_OPEN_TOKEN, true)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string, silent = false) {
    if (!silent) {
      setMessages(m => [...m, { role: 'user', content: text }])
    }
    setLoading(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text }),
      })
      if (!res.ok) throw new Error('Chat request failed')
      const data = await res.json()
      setMessages(m => [
        ...m,
        { role: 'eden', content: data.content || "Standing by.", reasoning: data.reasoning },
      ])
    } catch {
      if (!silent) {
        setMessages(m => [...m, { role: 'eden', content: 'Neural link interrupted.' }])
      }
    } finally {
      setLoading(false)
    }
  }

  function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    sendMessage(text)
  }

  return (
    <aside
      style={{
        width: 300,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        background: 'rgba(2, 8, 15, 0.98)',
        borderLeft: '1px solid rgba(0,186,220,0.08)',
        position: 'relative',
      }}
    >
      {/* Corner accents */}
      <div style={{
        position: 'absolute', top: 0, left: 0,
        width: 10, height: 10,
        borderTop: '1px solid rgba(0,186,220,0.35)',
        borderLeft: '1px solid rgba(0,186,220,0.35)',
        zIndex: 2,
      }} />
      <div style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 10, height: 10,
        borderBottom: '1px solid rgba(0,186,220,0.35)',
        borderRight: '1px solid rgba(0,186,220,0.35)',
        zIndex: 2,
      }} />

      {/* ─── Header ──────────────────────────────────────────────── */}
      <div
        style={{
          height: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          borderBottom: '1px solid rgba(0,186,220,0.07)',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          {/* Status dot */}
          <span style={{
            width: 5, height: 5,
            borderRadius: '50%',
            background: '#00cc6a',
            display: 'inline-block',
            boxShadow: '0 0 6px rgba(0,204,106,0.6)',
            animation: 'pulse-dot 3s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 10,
            letterSpacing: '0.22em',
            color: 'rgba(0,186,220,0.5)',
          }}>
            EDEN · NEURAL LINK
          </span>
        </div>
        <button
          onClick={() => setShowReasoning(r => !r)}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.1em',
            color: showReasoning ? '#00badc' : '#163d55',
            background: showReasoning ? 'rgba(0,186,220,0.06)' : 'transparent',
            padding: '2px 6px',
            borderRadius: 2,
            border: showReasoning ? '1px solid rgba(0,186,220,0.2)' : '1px solid transparent',
            transition: 'all 0.15s',
          }}
        >
          TRACE
        </button>
      </div>

      {/* ─── Messages ────────────────────────────────────────────── */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '14px 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        {messages.map((msg, i) => (
          <div key={i} className="fade-in">
            {msg.role === 'eden' ? (
              <div>
                {/* Reasoning trace */}
                {showReasoning && msg.reasoning && (
                  <div
                    style={{
                      marginBottom: 6,
                      padding: '6px 8px',
                      background: 'rgba(0,186,220,0.03)',
                      border: '1px solid rgba(0,186,220,0.07)',
                      borderLeft: '2px solid rgba(0,186,220,0.2)',
                      borderRadius: 1,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      color: '#163d55',
                      lineHeight: 1.5,
                      fontStyle: 'italic',
                    }}
                  >
                    {msg.reasoning}
                  </div>
                )}

                {/* Eden message */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    color: 'rgba(0,186,220,0.4)',
                    flexShrink: 0,
                    marginTop: 1,
                    letterSpacing: '0.05em',
                  }}>
                    J/
                  </span>
                  <p style={{
                    fontSize: 13,
                    fontWeight: 300,
                    lineHeight: 1.65,
                    color: '#9dd4ea',
                    margin: 0,
                  }}>
                    {msg.content}
                  </p>
                </div>
              </div>
            ) : (
              /* User message */
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingLeft: 4 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: '#163d55',
                  flexShrink: 0,
                  marginTop: 1,
                }}>
                  &gt;
                </span>
                <p style={{
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: '#316a86',
                  margin: 0,
                }}>
                  {msg.content}
                </p>
              </div>
            )}
          </div>
        ))}

        {/* Loading indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 2 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'rgba(0,186,220,0.4)',
              letterSpacing: '0.05em',
            }}>
              J/
            </span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  style={{
                    width: 4, height: 4,
                    borderRadius: '50%',
                    background: '#00badc',
                    display: 'inline-block',
                    animation: 'blink-cursor 1s step-start infinite',
                    animationDelay: `${i * 0.3}s`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ─── Input ───────────────────────────────────────────────── */}
      <div
        style={{
          padding: '10px 12px',
          borderTop: '1px solid rgba(0,186,220,0.07)',
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            background: 'rgba(0,186,220,0.03)',
            border: '1px solid rgba(0,186,220,0.1)',
            borderRadius: 2,
            padding: '7px 10px',
          }}
        >
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'rgba(0,186,220,0.35)',
            flexShrink: 0,
            paddingBottom: 1,
          }}>
            &gt;
          </span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="Query Eden..."
            rows={1}
            style={{
              flex: 1,
              background: 'transparent',
              resize: 'none',
              outline: 'none',
              border: 'none',
              fontSize: 12,
              fontWeight: 300,
              lineHeight: 1.5,
              color: '#9dd4ea',
              caretColor: '#00badc',
              fontFamily: 'var(--font-sans)',
            }}
          />
          <button
            onClick={handleSend}
            disabled={loading || !input.trim()}
            style={{
              flexShrink: 0,
              width: 22, height: 22,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: loading || !input.trim() ? 'transparent' : 'rgba(0,186,220,0.12)',
              border: `1px solid ${loading || !input.trim() ? 'rgba(0,186,220,0.1)' : 'rgba(0,186,220,0.3)'}`,
              borderRadius: 2,
              color: loading || !input.trim() ? '#163d55' : '#00badc',
              fontSize: 12,
              transition: 'all 0.15s',
              cursor: loading || !input.trim() ? 'default' : 'pointer',
            }}
          >
            ↑
          </button>
        </div>
      </div>
    </aside>
  )
}
