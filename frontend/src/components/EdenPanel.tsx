import { useState, useEffect, useRef, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'

interface Message {
  role: 'eden' | 'user'
  content: string
  reasoning?: string
}

const SESSION_OPEN_TOKEN = '__session_open__'

// ─── Speech types ─────────────────────────────────────────────────────────────

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }
}

// ─── TTS ──────────────────────────────────────────────────────────────────────

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

// ─── Markdown renderer for Eden messages ─────────────────────────────────────

function EdenMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      components={{
        p: ({ children }) => (
          <p style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 300, lineHeight: 1.65, color: '#9dd4ea' }}>
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
          <ul style={{ margin: '4px 0 8px', paddingLeft: 14, color: '#9dd4ea' }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: '4px 0 8px', paddingLeft: 14, color: '#9dd4ea' }}>{children}</ol>
        ),
        li: ({ children }) => (
          <li style={{ fontSize: 13, fontWeight: 300, lineHeight: 1.6, marginBottom: 2 }}>{children}</li>
        ),
        code: ({ children, className }) => {
          const isBlock = !!className
          return isBlock ? (
            <pre style={{
              margin: '6px 0', padding: '8px 10px',
              background: 'rgba(0,186,220,0.04)',
              border: '1px solid rgba(0,186,220,0.1)',
              borderRadius: 2, overflowX: 'auto',
            }}>
              <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#5fa8c8' }}>
                {children}
              </code>
            </pre>
          ) : (
            <code style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: '#00badc',
              background: 'rgba(0,186,220,0.06)', padding: '1px 4px', borderRadius: 2,
            }}>
              {children}
            </code>
          )
        },
        h1: ({ children }) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.1em', color: '#cde8f5', marginBottom: 6 }}>{children}</div>,
        h2: ({ children }) => <div style={{ fontFamily: 'var(--font-display)', fontSize: 12, fontWeight: 600, letterSpacing: '0.08em', color: '#cde8f5', marginBottom: 4 }}>{children}</div>,
        h3: ({ children }) => <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em', color: '#316a86', marginBottom: 4, textTransform: 'uppercase' }}>{children}</div>,
        blockquote: ({ children }) => (
          <blockquote style={{
            margin: '4px 0', paddingLeft: 8,
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

// ─── Thinking indicator ───────────────────────────────────────────────────────

function ThinkingIndicator() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingTop: 2 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(0,186,220,0.4)', letterSpacing: '0.05em' }}>
        J/
      </span>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 14 }}>
        {[0.5, 1.0, 0.7, 1.0, 0.6].map((h, i) => (
          <div key={i} style={{
            width: 2,
            height: `${h * 10}px`,
            background: '#00badc',
            borderRadius: 1,
            animation: 'blink-cursor 0.7s step-start infinite',
            animationDelay: `${i * 0.1}s`,
            opacity: 0.7,
          }} />
        ))}
      </div>
    </div>
  )
}

// ─── EdenPanel ────────────────────────────────────────────────────────────────

interface EdenPanelProps {
  collapsed: boolean
  onToggleCollapse: () => void
}

export default function EdenPanel({ collapsed, onToggleCollapse }: EdenPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)
  const [voiceEnabled, setVoiceEnabled] = useState(false)
  const [listening, setListening] = useState(false)
  const [speechSupported] = useState(() =>
    typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window)
  )

  const bottomRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const recognizerRef = useRef<InstanceType<typeof SpeechRecognition> | null>(null)
  const lastUserMessageRef = useRef('')

  useEffect(() => { sendMessage(SESSION_OPEN_TOKEN, true) }, [])
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])
  useEffect(() => () => { window.speechSynthesis?.cancel() }, [])

  // Global ⌘J focuses input
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'j') {
        e.preventDefault()
        if (collapsed) onToggleCollapse()
        setTimeout(() => inputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [collapsed, onToggleCollapse])

  const sendMessage = useCallback(async (text: string, silent = false) => {
    if (!silent) {
      lastUserMessageRef.current = text
      setMessages(m => [...m, { role: 'user', content: text }])
    }
    setLoading(true)

    // Add empty Eden message slot for streaming to fill
    const streamPlaceholder: Message = { role: 'eden', content: '' }
    if (!silent) {
      setMessages(m => [...m, streamPlaceholder])
    }

    // Build history for multi-turn context (last 20 messages, exclude the one we just added)
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
          history: silent ? [] : buildHistory(
            // Use functional form to get current state at send time
            // (messages state may not include the just-pushed user msg yet)
            messages.filter(m => m.content)
          ),
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
          } catch { /* malformed chunk, skip */ }
        }
      }

      if (silent) {
        // Session open — add as first message
        setMessages([{ role: 'eden', content: accumulated }])
      }

      if (!silent && voiceEnabled && accumulated) speakText(accumulated)
    } catch {
      const fallback = { role: 'eden' as const, content: 'Neural link interrupted.' }
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
    if (e.key === 'Escape') { setInput('') }
    if (e.key === 'ArrowUp' && !input && lastUserMessageRef.current) {
      e.preventDefault()
      setInput(lastUserMessageRef.current)
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

  // ── Collapsed tab ─────────────────────────────────────────────────────────
  if (collapsed) {
    return (
      <div
        onClick={onToggleCollapse}
        style={{
          width: 20,
          flexShrink: 0,
          borderLeft: '1px solid rgba(0,186,220,0.08)',
          background: 'rgba(2, 8, 15, 0.98)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          transition: 'background 0.15s',
        }}
        title="Expand Eden (⌘J)"
      >
        <span style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 8,
          color: 'rgba(0,186,220,0.3)',
          letterSpacing: '0.1em',
          writingMode: 'vertical-rl',
          textOrientation: 'mixed',
          transform: 'rotate(180deg)',
        }}>
          EDEN
        </span>
      </div>
    )
  }

  return (
    <aside style={{
      width: 300,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      background: 'rgba(2, 8, 15, 0.98)',
      borderLeft: '1px solid rgba(0,186,220,0.08)',
      position: 'relative',
    }}>
      {/* Corner accents */}
      <div style={{ position: 'absolute', top: 0, left: 0, width: 10, height: 10, borderTop: '1px solid rgba(0,186,220,0.35)', borderLeft: '1px solid rgba(0,186,220,0.35)', zIndex: 2 }} />
      <div style={{ position: 'absolute', bottom: 0, right: 0, width: 10, height: 10, borderBottom: '1px solid rgba(0,186,220,0.35)', borderRight: '1px solid rgba(0,186,220,0.35)', zIndex: 2 }} />

      {/* ─── Header ──────────────────────────────────────────────── */}
      <div style={{ height: 36, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 12px', borderBottom: '1px solid rgba(0,186,220,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#00cc6a', display: 'inline-block', boxShadow: '0 0 6px rgba(0,204,106,0.6)', animation: 'pulse-dot 3s ease-in-out infinite' }} />
          <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 10, letterSpacing: '0.22em', color: 'rgba(0,186,220,0.5)' }}>
            EDEN · NEURAL LINK
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {speechSupported && (
            <button onClick={() => { if (voiceEnabled) window.speechSynthesis?.cancel(); setVoiceEnabled(v => !v) }}
              title={voiceEnabled ? 'Mute voice' : 'Enable voice responses'}
              style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: voiceEnabled ? '#00badc' : '#316a86', background: voiceEnabled ? 'rgba(0,186,220,0.06)' : 'transparent', padding: '2px 5px', borderRadius: 2, border: voiceEnabled ? '1px solid rgba(0,186,220,0.2)' : '1px solid transparent', transition: 'all 0.15s', lineHeight: 1 }}>
              {voiceEnabled ? '◉' : '◎'}
            </button>
          )}
          <button onClick={() => setShowReasoning(r => !r)}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em', color: showReasoning ? '#00badc' : '#316a86', background: showReasoning ? 'rgba(0,186,220,0.06)' : 'transparent', padding: '2px 6px', borderRadius: 2, border: showReasoning ? '1px solid rgba(0,186,220,0.2)' : '1px solid transparent', transition: 'all 0.15s' }}>
            TRACE
          </button>
          <button onClick={onToggleCollapse} title="Collapse (⌘J)"
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#316a86', padding: '2px 4px', lineHeight: 1 }}>
            ›
          </button>
        </div>
      </div>

      {/* ─── Listening indicator ─────────────────────────────────── */}
      {listening && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', background: 'rgba(0,186,220,0.04)', borderBottom: '1px solid rgba(0,186,220,0.08)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {[0.6, 1.0, 0.7, 1.0, 0.5].map((h, i) => (
              <div key={i} style={{ width: 2, height: `${h * 12}px`, background: '#00badc', borderRadius: 1, animation: 'blink-cursor 0.6s step-start infinite', animationDelay: `${i * 0.12}s`, opacity: 0.8 }} />
            ))}
          </div>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: '#00badc' }}>LISTENING</span>
          <button onClick={() => recognizerRef.current?.stop()} style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 9, color: '#316a86', letterSpacing: '0.08em' }}>CANCEL</button>
        </div>
      )}

      {/* ─── Messages ────────────────────────────────────────────── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {messages.map((msg, i) => (
          <div key={i} className="fade-in">
            {msg.role === 'eden' ? (
              <div>
                {showReasoning && msg.reasoning && (
                  <div style={{ marginBottom: 6, padding: '6px 8px', background: 'rgba(0,186,220,0.03)', border: '1px solid rgba(0,186,220,0.07)', borderLeft: '2px solid rgba(0,186,220,0.2)', borderRadius: 1, fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', lineHeight: 1.5, fontStyle: 'italic' }}>
                    {msg.reasoning}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'rgba(0,186,220,0.4)', flexShrink: 0, marginTop: 2, letterSpacing: '0.05em' }}>J/</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <EdenMarkdown content={msg.content} />
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingLeft: 4 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#316a86', flexShrink: 0, marginTop: 1 }}>&gt;</span>
                <p style={{ fontSize: 12, lineHeight: 1.5, color: '#316a86', margin: 0 }}>{msg.content}</p>
              </div>
            )}
          </div>
        ))}

        {loading && <ThinkingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* ─── Input ───────────────────────────────────────────────── */}
      <div style={{ padding: '10px 12px', borderTop: '1px solid rgba(0,186,220,0.07)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, background: 'rgba(0,186,220,0.03)', border: `1px solid ${listening ? 'rgba(0,186,220,0.3)' : 'rgba(0,186,220,0.1)'}`, borderRadius: 2, padding: '7px 8px', transition: 'border-color 0.2s' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'rgba(0,186,220,0.35)', flexShrink: 0, paddingBottom: 1 }}>&gt;</span>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={listening ? 'Listening...' : 'Query Eden...'}
            rows={1}
            style={{ flex: 1, background: 'transparent', resize: 'none', outline: 'none', border: 'none', fontSize: 12, fontWeight: 300, lineHeight: 1.5, color: '#9dd4ea', caretColor: '#00badc', fontFamily: 'var(--font-sans)' }}
          />
          {speechSupported && (
            <button onClick={toggleListening} disabled={loading} title={listening ? 'Stop' : 'Speak (⏺)'}
              style={{ flexShrink: 0, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: listening ? 'rgba(0,186,220,0.15)' : 'transparent', border: `1px solid ${listening ? 'rgba(0,186,220,0.4)' : 'rgba(0,186,220,0.1)'}`, borderRadius: 2, color: listening ? '#00badc' : '#316a86', fontSize: 11, transition: 'all 0.15s', cursor: loading ? 'default' : 'pointer' }}>
              {listening ? '■' : '⏺'}
            </button>
          )}
          <button onClick={handleSend} disabled={loading || !input.trim()}
            style={{ flexShrink: 0, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', background: loading || !input.trim() ? 'transparent' : 'rgba(0,186,220,0.12)', border: `1px solid ${loading || !input.trim() ? 'rgba(0,186,220,0.1)' : 'rgba(0,186,220,0.3)'}`, borderRadius: 2, color: loading || !input.trim() ? '#316a86' : '#00badc', fontSize: 12, transition: 'all 0.15s', cursor: loading || !input.trim() ? 'default' : 'pointer' }}>
            ↑
          </button>
        </div>
        <div style={{ marginTop: 5, fontFamily: 'var(--font-mono)', fontSize: 9, color: '#1e4d6b', letterSpacing: '0.07em', display: 'flex', justifyContent: 'space-between' }}>
          <span>↑ RECALL · ESC CLEAR</span>
          <span>⌘J FOCUS</span>
        </div>
      </div>
    </aside>
  )
}
