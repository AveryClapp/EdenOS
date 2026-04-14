import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'eden' | 'user'
  content: string
}

const SESSION_OPEN_TOKEN = '__session_open__'

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }
}

function speakText(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = 0.92
  utter.pitch = 0.85
  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices()
    for (const name of ['Google UK English Male', 'Daniel', 'Arthur', 'Google US English', 'Samantha']) {
      const v = voices.find(v => v.name.includes(name))
      if (v) { utter.voice = v; break }
    }
    window.speechSynthesis.speak(utter)
  }
  if (window.speechSynthesis.getVoices().length > 0) pickVoice()
  else { window.speechSynthesis.onvoiceschanged = () => { pickVoice(); window.speechSynthesis.onvoiceschanged = null } }
}

function EdenMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => (
          <p style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 300, lineHeight: 1.7, color: '#b8dff0' }}>
            {children}
          </p>
        ),
        strong: ({ children }) => (
          <strong style={{ color: '#cde8f5', fontWeight: 500 }}>{children}</strong>
        ),
        em: ({ children }) => (
          <em style={{ color: '#5fa8c8', fontStyle: 'italic' }}>{children}</em>
        ),
        ul: ({ children }) => (
          <ul style={{ margin: '4px 0 10px', paddingLeft: 16, color: '#b8dff0' }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: '4px 0 10px', paddingLeft: 16, color: '#b8dff0' }}>{children}</ol>
        ),
        li: ({ children }) => (
          <li style={{ fontSize: 14, fontWeight: 300, lineHeight: 1.65, marginBottom: 3 }}>{children}</li>
        ),
        code: ({ children, className }) => {
          const isBlock = !!className
          return isBlock ? (
            <pre style={{
              margin: '8px 0', padding: '10px 14px',
              background: 'rgba(0,186,220,0.04)',
              border: '1px solid rgba(0,186,220,0.1)',
              borderRadius: 2, overflowX: 'auto',
            }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: '#5fa8c8' }}>
                {children}
              </code>
            </pre>
          ) : (
            <code style={{
              fontFamily: 'var(--font-mono)', fontSize: 12, color: '#00badc',
              background: 'rgba(0,186,220,0.06)', padding: '1px 5px', borderRadius: 2,
            }}>
              {children}
            </code>
          )
        },
        h1: ({ children }) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, fontWeight: 600, letterSpacing: '0.1em', color: '#cde8f5', marginBottom: 8, marginTop: 4 }}>{children}</div>,
        h2: ({ children }) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', color: '#cde8f5', marginBottom: 6, marginTop: 2 }}>{children}</div>,
        h3: ({ children }) => <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: '#316a86', marginBottom: 6, textTransform: 'uppercase' }}>{children}</div>,
        blockquote: ({ children }) => (
          <blockquote style={{
            margin: '6px 0', paddingLeft: 12,
            borderLeft: '2px solid rgba(0,186,220,0.3)',
            color: '#5fa8c8', fontStyle: 'italic',
          }}>
            {children}
          </blockquote>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function ThinkingDots() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingTop: 4 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(0,186,220,0.35)', letterSpacing: '0.06em' }}>
        J/
      </span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 16 }}>
        {[0.5, 1.0, 0.7, 1.0, 0.6].map((h, i) => (
          <div key={i} style={{
            width: 2,
            height: `${h * 12}px`,
            background: '#00badc',
            borderRadius: 1,
            animation: 'blink-cursor 0.7s step-start infinite',
            animationDelay: `${i * 0.1}s`,
            opacity: 0.6,
          }} />
        ))}
      </div>
    </div>
  )
}

export default function Jarvis() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [listening, setListening] = useState(false)
  const [speechSupported] = useState(() =>
    typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastUserRef = useRef('')
  const recognizerRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null)

  useEffect(() => { sendMessage(SESSION_OPEN_TOKEN, true) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => () => { window.speechSynthesis?.cancel() }, [])

  // Focus input on mount
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 100) }, [])

  const sendMessage = useCallback(async (text: string, silent = false) => {
    if (!silent) {
      lastUserRef.current = text
      setMessages(m => [...m, { role: 'user', content: text }])
    }
    setLoading(true)

    if (!silent) {
      setMessages(m => [...m, { role: 'eden', content: '' }])
    }

    const buildHistory = (currentMessages: Message[]) =>
      currentMessages
        .slice(-20)
        .filter(m => m.content)
        .map(m => ({
          role: m.role === 'eden' ? 'assistant' : 'user',
          content: m.content,
        }))

    try {
      const res = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: silent ? [] : buildHistory(messages.filter(m => m.content)),
        }),
      })
      if (!res.ok || !res.body) throw new Error()

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n\n')
        buffer = lines.pop() ?? ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          try {
            const data = JSON.parse(line.slice(6))
            if (data.done) break
            if (data.error) throw new Error(data.error)
            if (data.delta) {
              accumulated += data.delta
              if (silent) continue
              setMessages(m => {
                const next = [...m]
                next[next.length - 1] = { role: 'eden', content: accumulated }
                return next
              })
            }
          } catch { /* malformed chunk */ }
        }
      }

      if (silent) {
        setMessages([{ role: 'eden', content: accumulated }])
      }

      if (!silent && voiceEnabled && accumulated) speakText(accumulated)
    } catch {
      const fallback = { role: 'eden' as const, content: 'Connection interrupted.' }
      if (silent) setMessages([fallback])
      else setMessages(m => { const n = [...m]; n[n.length - 1] = fallback; return n })
    } finally {
      setLoading(false)
    }
  }, [voiceEnabled, messages])

  function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    sendMessage(text)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') setInput('')
    if (e.key === 'ArrowUp' && !input && lastUserRef.current) {
      e.preventDefault()
      setInput(lastUserRef.current)
    }
  }

  function toggleListening() {
    if (listening) { recognizerRef.current?.stop(); return }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'en-US'; rec.interimResults = false; rec.maxAlternatives = 1
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const t = e.results[0][0].transcript.trim()
      if (t) { setInput(''); sendMessage(t) }
    }
    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)
    recognizerRef.current = rec
    rec.start()
    setListening(true)
    window.speechSynthesis?.cancel()
  }

  function clearConversation() {
    window.speechSynthesis?.cancel()
    setMessages([])
    setInput('')
    sendMessage(SESSION_OPEN_TOKEN, true)
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--color-base)',
      position: 'relative',
    }}>
      {/* Corner accents */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 14, height: 14, borderTop: '1px solid rgba(0,186,220,0.25)', borderLeft: '1px solid rgba(0,186,220,0.25)', pointerEvents: 'none', zIndex: 2 }} />
      <div style={{ position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderTop: '1px solid rgba(0,186,220,0.25)', borderRight: '1px solid rgba(0,186,220,0.25)', pointerEvents: 'none', zIndex: 2 }} />

      {/* Header */}
      <div style={{
        height: 44,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        borderBottom: '1px solid rgba(0,186,220,0.07)',
        flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: '#00cc6a',
            display: 'inline-block',
            boxShadow: '0 0 8px rgba(0,204,106,0.6)',
            animation: 'pulse-dot 3s ease-in-out infinite',
          }} />
          <span style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 600,
            fontSize: 11,
            letterSpacing: '0.22em',
            color: 'rgba(0,186,220,0.45)',
          }}>
            EDEN · EXECUTIVE LINK
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {speechSupported && (
            <button
              onClick={() => { if (voiceEnabled) window.speechSynthesis?.cancel(); setVoiceEnabled(v => !v) }}
              title={voiceEnabled ? 'Mute voice' : 'Enable voice'}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 11,
                color: voiceEnabled ? '#00badc' : '#316a86',
                background: voiceEnabled ? 'rgba(0,186,220,0.06)' : 'transparent',
                padding: '3px 7px', borderRadius: 2,
                border: voiceEnabled ? '1px solid rgba(0,186,220,0.2)' : '1px solid transparent',
                transition: 'all 0.15s', cursor: 'pointer', lineHeight: 1,
              }}
            >
              {voiceEnabled ? '◉' : '◎'}
            </button>
          )}
          <button
            onClick={clearConversation}
            title="Clear conversation"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 9,
              letterSpacing: '0.12em', color: '#1e4d6b',
              background: 'none', border: 'none',
              cursor: 'pointer', padding: '3px 6px',
              transition: 'color 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.color = '#316a86')}
            onMouseLeave={e => (e.currentTarget.style.color = '#1e4d6b')}
          >
            CLEAR
          </button>
        </div>
      </div>

      {/* Listening bar */}
      {listening && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '8px 24px',
          background: 'rgba(0,186,220,0.03)',
          borderBottom: '1px solid rgba(0,186,220,0.07)',
          flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
            {[0.6, 1.0, 0.7, 1.0, 0.5].map((h, i) => (
              <div key={i} style={{ width: 2, height: `${h * 14}px`, background: '#00badc', borderRadius: 1, animation: 'blink-cursor 0.6s step-start infinite', animationDelay: `${i * 0.12}s`, opacity: 0.8 }} />
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: '#00badc' }}>LISTENING</span>
          <button onClick={() => recognizerRef.current?.stop()} style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
            CANCEL
          </button>
        </div>
      )}

      {/* Messages */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        padding: '0 0 24px',
      }}>
        {/* Centered content column */}
        <div style={{
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          padding: '28px 32px 0',
          display: 'flex',
          flexDirection: 'column',
          gap: 28,
          flex: 1,
        }}>
          {messages.map((msg, i) => (
            <div key={i} className="fade-in">
              {msg.role === 'eden' ? (
                <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 11,
                    color: 'rgba(0,186,220,0.35)',
                    flexShrink: 0,
                    marginTop: 3,
                    letterSpacing: '0.06em',
                    lineHeight: 1,
                  }}>
                    J/
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <EdenMarkdown content={msg.content} />
                  </div>
                </div>
              ) : (
                <div style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                }}>
                  <div style={{
                    maxWidth: '72%',
                    background: 'rgba(0,186,220,0.04)',
                    border: '1px solid rgba(0,186,220,0.1)',
                    borderRadius: '2px 2px 0 2px',
                    padding: '10px 14px',
                  }}>
                    <p style={{
                      fontSize: 13,
                      fontWeight: 300,
                      lineHeight: 1.6,
                      color: '#5fa8c8',
                      margin: 0,
                    }}>
                      {msg.content}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="fade-in">
              <ThinkingDots />
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>

      {/* Horizontal rule above input */}
      <div style={{ height: 1, background: 'linear-gradient(to right, transparent, rgba(0,186,220,0.08), transparent)', flexShrink: 0 }} />

      {/* Input area */}
      <div style={{
        flexShrink: 0,
        padding: '20px 24px 24px',
      }}>
        <div style={{
          maxWidth: 720,
          margin: '0 auto',
          position: 'relative',
        }}>
          {/* Textarea container */}
          <div style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            background: 'rgba(0,186,220,0.025)',
            border: `1px solid ${listening ? 'rgba(0,186,220,0.35)' : 'rgba(0,186,220,0.12)'}`,
            borderRadius: 3,
            padding: '10px 10px 10px 14px',
            transition: 'border-color 0.2s',
          }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 12,
              color: 'rgba(0,186,220,0.3)',
              flexShrink: 0,
              paddingBottom: 1,
              lineHeight: 1.6,
            }}>
              &gt;
            </span>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => {
                setInput(e.target.value)
                // Auto-resize
                e.target.style.height = 'auto'
                e.target.style.height = `${Math.min(e.target.scrollHeight, 200)}px`
              }}
              onKeyDown={handleKeyDown}
              placeholder={listening ? 'Listening...' : 'Instruct Eden...'}
              rows={1}
              style={{
                flex: 1,
                background: 'transparent',
                resize: 'none',
                outline: 'none',
                border: 'none',
                fontSize: 13,
                fontWeight: 300,
                lineHeight: 1.6,
                color: '#9dd4ea',
                caretColor: '#00badc',
                fontFamily: 'var(--font-sans)',
                minHeight: 24,
                maxHeight: 200,
                overflowY: 'auto',
              }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, paddingBottom: 1 }}>
              {speechSupported && (
                <button
                  onClick={toggleListening}
                  disabled={loading}
                  title={listening ? 'Stop listening' : 'Voice input'}
                  style={{
                    width: 26, height: 26,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: listening ? 'rgba(0,186,220,0.12)' : 'transparent',
                    border: `1px solid ${listening ? 'rgba(0,186,220,0.35)' : 'rgba(0,186,220,0.08)'}`,
                    borderRadius: 2,
                    color: listening ? '#00badc' : '#316a86',
                    fontSize: 12, cursor: loading ? 'default' : 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  {listening ? '■' : '⏺'}
                </button>
              )}
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  width: 26, height: 26,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: loading || !input.trim() ? 'transparent' : 'rgba(0,186,220,0.12)',
                  border: `1px solid ${loading || !input.trim() ? 'rgba(0,186,220,0.08)' : 'rgba(0,186,220,0.3)'}`,
                  borderRadius: 2,
                  color: loading || !input.trim() ? '#316a86' : '#00badc',
                  fontSize: 13, cursor: loading || !input.trim() ? 'default' : 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                ↑
              </button>
            </div>
          </div>

          {/* Hints */}
          <div style={{
            marginTop: 8,
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#1a3a52',
            letterSpacing: '0.07em',
          }}>
            <span>ENTER SEND · SHIFT+ENTER NEWLINE · ↑ RECALL</span>
            <span>ESC CLEAR INPUT</span>
          </div>
        </div>
      </div>
    </div>
  )
}
