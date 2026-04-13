import { useState, useEffect, useRef, useCallback } from 'react'

interface Message {
  role: 'eden' | 'user'
  content: string
  reasoning?: string
}

const SESSION_OPEN_TOKEN = '__session_open__'

// ─── Speech recognition types ────────────────────────────────────────────────

declare global {
  interface Window {
    SpeechRecognition: typeof SpeechRecognition
    webkitSpeechRecognition: typeof SpeechRecognition
  }
}

// ─── TTS helper ──────────────────────────────────────────────────────────────

function speakText(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()

  const utter = new SpeechSynthesisUtterance(text)
  utter.rate = 0.92
  utter.pitch = 0.85

  // Try to pick a clear, slightly deep voice
  const pickVoice = () => {
    const voices = window.speechSynthesis.getVoices()
    const preferred = [
      'Google UK English Male',
      'Daniel',        // macOS British
      'Arthur',        // macOS British
      'Google US English',
      'Samantha',      // macOS US
    ]
    for (const name of preferred) {
      const v = voices.find(v => v.name.includes(name))
      if (v) { utter.voice = v; break }
    }
    window.speechSynthesis.speak(utter)
  }

  // getVoices() may not be populated yet on first call
  if (window.speechSynthesis.getVoices().length > 0) {
    pickVoice()
  } else {
    window.speechSynthesis.onvoiceschanged = () => { pickVoice(); window.speechSynthesis.onvoiceschanged = null }
  }
}

// ─── EdenPanel ───────────────────────────────────────────────────────────────

export default function EdenPanel() {
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

  useEffect(() => {
    sendMessage(SESSION_OPEN_TOKEN, true)
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Cancel TTS when component unmounts
  useEffect(() => () => { window.speechSynthesis?.cancel() }, [])

  const sendMessage = useCallback(async (text: string, silent = false) => {
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
      const reply = data.content || 'Standing by.'
      setMessages(m => [...m, { role: 'eden', content: reply, reasoning: data.reasoning }])
      if (!silent && voiceEnabled) speakText(reply)
    } catch {
      if (!silent) {
        setMessages(m => [...m, { role: 'eden', content: 'Neural link interrupted.' }])
      }
    } finally {
      setLoading(false)
    }
  }, [voiceEnabled])

  function handleSend() {
    const text = input.trim()
    if (!text || loading) return
    setInput('')
    sendMessage(text)
  }

  function toggleListening() {
    if (listening) {
      recognizerRef.current?.stop()
      return
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const rec = new SR()
    rec.lang = 'en-US'
    rec.interimResults = false
    rec.maxAlternatives = 1

    rec.onresult = (e: SpeechRecognitionEvent) => {
      const transcript = e.results[0][0].transcript.trim()
      if (transcript) {
        setInput('')
        sendMessage(transcript)
      }
    }

    rec.onerror = () => setListening(false)
    rec.onend = () => setListening(false)

    recognizerRef.current = rec
    rec.start()
    setListening(true)

    // Stop any ongoing TTS before listening
    window.speechSynthesis?.cancel()
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {/* Voice output toggle */}
          {speechSupported && (
            <button
              onClick={() => {
                if (voiceEnabled) window.speechSynthesis?.cancel()
                setVoiceEnabled(v => !v)
              }}
              title={voiceEnabled ? 'Mute voice' : 'Enable voice responses'}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: voiceEnabled ? '#00badc' : '#316a86',
                background: voiceEnabled ? 'rgba(0,186,220,0.06)' : 'transparent',
                padding: '2px 5px',
                borderRadius: 2,
                border: voiceEnabled ? '1px solid rgba(0,186,220,0.2)' : '1px solid transparent',
                transition: 'all 0.15s',
                lineHeight: 1,
              }}
            >
              {voiceEnabled ? '◉' : '◎'}
            </button>
          )}

          {/* Reasoning trace toggle */}
          <button
            onClick={() => setShowReasoning(r => !r)}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              letterSpacing: '0.1em',
              color: showReasoning ? '#00badc' : '#316a86',
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
      </div>

      {/* ─── Listening indicator ─────────────────────────────────── */}
      {listening && (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          background: 'rgba(0,186,220,0.04)',
          borderBottom: '1px solid rgba(0,186,220,0.08)',
          flexShrink: 0,
        }}>
          {/* Animated waveform bars */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {[0.6, 1.0, 0.7, 1.0, 0.5].map((h, i) => (
              <div
                key={i}
                style={{
                  width: 2,
                  height: `${h * 12}px`,
                  background: '#00badc',
                  borderRadius: 1,
                  animation: 'blink-cursor 0.6s step-start infinite',
                  animationDelay: `${i * 0.12}s`,
                  opacity: 0.8,
                }}
              />
            ))}
          </div>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            letterSpacing: '0.12em',
            color: '#00badc',
          }}>
            LISTENING
          </span>
          <button
            onClick={() => recognizerRef.current?.stop()}
            style={{
              marginLeft: 'auto',
              fontFamily: 'var(--font-mono)',
              fontSize: 9,
              color: '#316a86',
              letterSpacing: '0.08em',
            }}
          >
            CANCEL
          </button>
        </div>
      )}

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
                      color: '#316a86',
                      lineHeight: 1.5,
                      fontStyle: 'italic',
                    }}
                  >
                    {msg.reasoning}
                  </div>
                )}
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
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', paddingLeft: 4 }}>
                <span style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  color: '#316a86',
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
            gap: 6,
            background: 'rgba(0,186,220,0.03)',
            border: `1px solid ${listening ? 'rgba(0,186,220,0.3)' : 'rgba(0,186,220,0.1)'}`,
            borderRadius: 2,
            padding: '7px 8px',
            transition: 'border-color 0.2s',
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
            placeholder={listening ? 'Listening...' : 'Query Eden...'}
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

          {/* Mic button */}
          {speechSupported && (
            <button
              onClick={toggleListening}
              disabled={loading}
              title={listening ? 'Stop listening' : 'Speak to Eden'}
              style={{
                flexShrink: 0,
                width: 22, height: 22,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: listening ? 'rgba(0,186,220,0.15)' : 'transparent',
                border: `1px solid ${listening ? 'rgba(0,186,220,0.4)' : 'rgba(0,186,220,0.1)'}`,
                borderRadius: 2,
                color: listening ? '#00badc' : '#316a86',
                fontSize: 11,
                transition: 'all 0.15s',
                cursor: loading ? 'default' : 'pointer',
              }}
            >
              {listening ? '■' : '⏺'}
            </button>
          )}

          {/* Send button */}
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
              color: loading || !input.trim() ? '#316a86' : '#00badc',
              fontSize: 12,
              transition: 'all 0.15s',
              cursor: loading || !input.trim() ? 'default' : 'pointer',
            }}
          >
            ↑
          </button>
        </div>

        {/* Voice hint */}
        {speechSupported && !listening && (
          <div style={{
            marginTop: 5,
            fontFamily: 'var(--font-mono)',
            fontSize: 9,
            color: '#1e4d6b',
            letterSpacing: '0.08em',
            textAlign: 'center',
          }}>
            {voiceEnabled ? '◉ VOICE ON · ⏺ TO SPEAK' : '⏺ TO SPEAK · ◎ FOR RESPONSES'}
          </div>
        )}
      </div>
    </aside>
  )
}
