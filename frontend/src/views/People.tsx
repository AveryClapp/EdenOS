import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Person, Commitment, RelationshipType } from '../types'
import {
  listPeople, createPerson, updatePerson, deletePerson, logContact,
  createCommitment, updateCommitment, deleteCommitment,
} from '../api/people'

const REL_LABELS: Record<RelationshipType, string> = {
  friend: 'Friend',
  colleague: 'Colleague',
  mentor: 'Mentor',
  family: 'Family',
  acquaintance: 'Acquaintance',
}

const REL_COLORS: Record<RelationshipType, string> = {
  friend:       'rgba(0,186,220,0.55)',
  colleague:    'rgba(160,210,255,0.45)',
  mentor:       'rgba(180,140,255,0.55)',
  family:       'rgba(0,204,106,0.55)',
  acquaintance: 'rgba(82,126,150,0.6)',
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function stalePill(person: Person) {
  const days = daysSince(person.last_contact_date)
  if (days === null) return { label: 'NEVER', color: '#c0392b' }
  if (days > 30)     return { label: `${days}d ago`, color: '#e67e22' }
  if (days > 14)     return { label: `${days}d ago`, color: '#527e96' }
  return { label: `${days}d ago`, color: 'rgba(0,204,106,0.7)' }
}

function CommitmentRow({
  c,
  onStatusChange,
  onDelete,
}: {
  c: Commitment
  onStatusChange: (id: string, status: 'open' | 'done' | 'dropped') => void
  onDelete: (id: string) => void
}) {
  const isOverdue = c.due_date && new Date(c.due_date) < new Date() && c.status === 'open'
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '5px 0',
      borderBottom: '1px solid rgba(0,186,220,0.04)',
      opacity: c.status !== 'open' ? 0.45 : 1,
    }}>
      <button
        onClick={() => onStatusChange(c.id, c.status === 'open' ? 'done' : 'open')}
        style={{
          width: 14, height: 14, flexShrink: 0,
          border: `1px solid ${c.status === 'done' ? 'rgba(0,204,106,0.6)' : 'rgba(0,186,220,0.25)'}`,
          borderRadius: 2,
          background: c.status === 'done' ? 'rgba(0,204,106,0.15)' : 'transparent',
          cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 9, color: '#00cc6a',
        }}
      >
        {c.status === 'done' ? '✓' : ''}
      </button>
      <span style={{
        flex: 1, fontSize: 12, fontWeight: 300, color: '#90c4dd', lineHeight: 1.5,
        textDecoration: c.status === 'done' ? 'line-through' : 'none',
      }}>
        {c.description}
      </span>
      {c.due_date && (
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em',
          color: isOverdue ? '#c0392b' : '#527e96',
          flexShrink: 0,
        }}>
          {isOverdue ? '!' : ''}{c.due_date}
        </span>
      )}
      <button
        onClick={() => onDelete(c.id)}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#1e3a52', fontSize: 12, flexShrink: 0, padding: '0 2px', lineHeight: 1 }}
        onMouseEnter={e => (e.currentTarget.style.color = '#527e96')}
        onMouseLeave={e => (e.currentTarget.style.color = '#1e3a52')}
      >
        ×
      </button>
    </div>
  )
}

function AddCommitmentForm({ personId, onDone }: { personId: string; onDone: () => void }) {
  const [desc, setDesc] = useState('')
  const [dueDate, setDueDate] = useState('')
  const qc = useQueryClient()

  const add = useMutation({
    mutationFn: () => createCommitment(personId, { description: desc.trim(), due_date: dueDate || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['people'] }); onDone() },
  })

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 6 }}>
      <input
        autoFocus
        value={desc}
        onChange={e => setDesc(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && desc.trim()) add.mutate(); if (e.key === 'Escape') onDone() }}
        placeholder="commitment..."
        style={{
          flex: 1, background: 'rgba(0,186,220,0.03)',
          border: '1px solid rgba(0,186,220,0.15)', borderRadius: 2,
          color: '#90c4dd', fontSize: 12, fontFamily: 'var(--font-sans)',
          padding: '4px 8px', outline: 'none',
        }}
      />
      <input
        type="date"
        value={dueDate}
        onChange={e => setDueDate(e.target.value)}
        style={{
          background: 'rgba(0,186,220,0.03)',
          border: '1px solid rgba(0,186,220,0.1)', borderRadius: 2,
          color: '#527e96', fontSize: 11, fontFamily: 'var(--font-mono)',
          padding: '4px 6px', outline: 'none', width: 120,
        }}
      />
      <button
        onClick={() => { if (desc.trim()) add.mutate() }}
        disabled={!desc.trim() || add.isPending}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
          color: desc.trim() ? '#00badc' : '#1e3a52',
          background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px',
        }}
      >
        ADD
      </button>
      <button
        onClick={onDone}
        style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#1e3a52', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
      >
        ×
      </button>
    </div>
  )
}

function PersonCard({ person }: { person: Person }) {
  const [expanded, setExpanded] = useState(false)
  const [addingCommitment, setAddingCommitment] = useState(false)
  const qc = useQueryClient()

  const { label: staleLabel, color: staleColor } = stalePill(person)
  const openCommitments = person.commitments.filter(c => c.status === 'open')

  const contact = useMutation({
    mutationFn: () => logContact(person.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  })

  const removeCommitment = useMutation({
    mutationFn: (id: string) => deleteCommitment(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  })

  const changeCommitmentStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'open' | 'done' | 'dropped' }) =>
      updateCommitment(id, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  })

  const deletePerson_ = useMutation({
    mutationFn: () => deletePerson(person.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['people'] }),
  })

  const relColor = REL_COLORS[person.relationship_type] || 'rgba(82,126,150,0.5)'

  return (
    <div style={{
      background: 'rgba(0,186,220,0.025)',
      border: '1px solid rgba(0,186,220,0.08)',
      borderRadius: 3,
      overflow: 'hidden',
      transition: 'border-color 0.2s',
    }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'rgba(0,186,220,0.16)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'rgba(0,186,220,0.08)')}
    >
      {/* Card header */}
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', cursor: 'pointer' }}
        onClick={() => setExpanded(v => !v)}
      >
        {/* Avatar glyph */}
        <div style={{
          width: 30, height: 30, borderRadius: '50%', flexShrink: 0,
          background: `linear-gradient(135deg, ${relColor.replace('0.55', '0.1')}, ${relColor.replace('0.55', '0.2')})`,
          border: `1px solid ${relColor}`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600,
          color: relColor.includes('220') ? '#00badc' : relColor.includes('106') ? '#00cc6a' : relColor.includes('140') ? '#b08fff' : '#90c4dd',
        }}>
          {person.name.charAt(0).toUpperCase()}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 400, color: '#e4f2fa', letterSpacing: '0.01em' }}>
              {person.name}
            </span>
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 8, letterSpacing: '0.1em',
              color: relColor.includes('220') ? 'rgba(0,186,220,0.55)' : relColor.includes('106') ? 'rgba(0,204,106,0.55)' : '#7a5fcf',
              textTransform: 'uppercase',
            }}>
              {REL_LABELS[person.relationship_type]}
            </span>
            {openCommitments.length > 0 && (
              <span style={{
                fontFamily: 'var(--font-mono)', fontSize: 9,
                color: 'rgba(0,186,220,0.6)',
                background: 'rgba(0,186,220,0.06)',
                padding: '1px 5px', borderRadius: 2,
              }}>
                {openCommitments.length} open
              </span>
            )}
          </div>
          {person.context && (
            <div style={{ fontSize: 11, color: '#527e96', fontWeight: 300, marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {person.context}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.06em',
            color: staleColor,
          }}>
            {staleLabel}
          </span>
          <button
            onClick={e => { e.stopPropagation(); contact.mutate() }}
            disabled={contact.isPending}
            title="Log contact"
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
              color: '#00cc6a',
              background: 'rgba(0,204,106,0.06)', border: '1px solid rgba(0,204,106,0.2)',
              borderRadius: 2, padding: '2px 7px', cursor: 'pointer',
            }}
          >
            CONTACT
          </button>
          <span style={{ color: 'rgba(0,186,220,0.3)', fontSize: 10 }}>
            {expanded ? '▴' : '▾'}
          </span>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div style={{ padding: '0 14px 12px', borderTop: '1px solid rgba(0,186,220,0.06)' }}>
          {/* Commitments */}
          <div style={{ marginTop: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: '#527e96' }}>
                COMMITMENTS
              </span>
              <button
                onClick={() => setAddingCommitment(v => !v)}
                style={{
                  fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
                  color: 'rgba(0,186,220,0.5)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 4px',
                }}
              >
                + ADD
              </button>
            </div>

            {person.commitments.length === 0 && !addingCommitment && (
              <div style={{ fontSize: 11, color: '#2c526a', fontStyle: 'italic', padding: '4px 0' }}>
                no commitments
              </div>
            )}

            {person.commitments.map(c => (
              <CommitmentRow
                key={c.id}
                c={c}
                onStatusChange={(id, status) => changeCommitmentStatus.mutate({ id, status })}
                onDelete={id => removeCommitment.mutate(id)}
              />
            ))}

            {addingCommitment && (
              <AddCommitmentForm personId={person.id} onDone={() => setAddingCommitment(false)} />
            )}
          </div>

          {/* Notes */}
          {person.notes && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: '#527e96', marginBottom: 4 }}>
                NOTES
              </div>
              <div style={{ fontSize: 12, fontWeight: 300, color: '#7ab0c8', lineHeight: 1.5 }}>
                {person.notes}
              </div>
            </div>
          )}

          {/* Danger zone */}
          <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
            <button
              onClick={() => { if (confirm(`Remove ${person.name}?`)) deletePerson_.mutate() }}
              style={{
                fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.08em',
                color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer',
              }}
            >
              REMOVE
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function AddPersonForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('')
  const [rel, setRel] = useState<RelationshipType>('friend')
  const [context, setContext] = useState('')
  const qc = useQueryClient()

  const add = useMutation({
    mutationFn: () => createPerson({ name: name.trim(), relationship_type: rel, context: context.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['people'] }); onDone() },
  })

  return (
    <div style={{
      background: 'rgba(0,186,220,0.03)',
      border: '1px solid rgba(0,186,220,0.15)',
      borderRadius: 3, padding: '14px 16px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', color: '#527e96', marginBottom: 10 }}>
        ADD PERSON
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input
          autoFocus
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && name.trim()) add.mutate(); if (e.key === 'Escape') onDone() }}
          placeholder="Name"
          style={{
            background: 'transparent', border: '1px solid rgba(0,186,220,0.15)',
            borderRadius: 2, color: '#e4f2fa', fontSize: 13, fontFamily: 'var(--font-sans)',
            padding: '6px 10px', outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 6 }}>
          <select
            value={rel}
            onChange={e => setRel(e.target.value as RelationshipType)}
            style={{
              flex: 1, background: 'rgba(0,186,220,0.04)', border: '1px solid rgba(0,186,220,0.15)',
              borderRadius: 2, color: '#90c4dd', fontSize: 12, fontFamily: 'var(--font-mono)',
              padding: '5px 8px', outline: 'none', letterSpacing: '0.04em',
            }}
          >
            {(Object.keys(REL_LABELS) as RelationshipType[]).map(k => (
              <option key={k} value={k}>{REL_LABELS[k]}</option>
            ))}
          </select>
          <input
            value={context}
            onChange={e => setContext(e.target.value)}
            placeholder="context (optional)"
            style={{
              flex: 2, background: 'transparent', border: '1px solid rgba(0,186,220,0.15)',
              borderRadius: 2, color: '#90c4dd', fontSize: 12, fontFamily: 'var(--font-sans)',
              padding: '5px 10px', outline: 'none',
            }}
          />
        </div>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onDone} style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#527e96', background: 'none', border: 'none', cursor: 'pointer', letterSpacing: '0.08em' }}>
            CANCEL
          </button>
          <button
            onClick={() => { if (name.trim()) add.mutate() }}
            disabled={!name.trim() || add.isPending}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
              color: name.trim() ? '#00badc' : '#1e3a52',
              background: name.trim() ? 'rgba(0,186,220,0.08)' : 'transparent',
              border: `1px solid ${name.trim() ? 'rgba(0,186,220,0.25)' : 'transparent'}`,
              borderRadius: 2, padding: '4px 10px', cursor: 'pointer',
            }}
          >
            ADD
          </button>
        </div>
      </div>
    </div>
  )
}

export default function People() {
  const [addingPerson, setAddingPerson] = useState(false)
  const [filter, setFilter] = useState<RelationshipType | 'all'>('all')

  const { data: people = [], isLoading } = useQuery<Person[]>({
    queryKey: ['people'],
    queryFn: () => listPeople(),
  })

  const stale = people.filter(p => {
    const days = daysSince(p.last_contact_date)
    return days === null || days > 30
  })

  const filtered = filter === 'all'
    ? people
    : people.filter(p => p.relationship_type === filter)

  const hasOverdueCommitments = people.some(p =>
    p.commitments.some(c => c.status === 'open' && c.due_date && new Date(c.due_date) < new Date())
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 900, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <div style={{ width: 2, height: 14, background: 'linear-gradient(to bottom, #00badc, rgba(0,186,220,0.2))' }} />
            <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 13, fontWeight: 600, letterSpacing: '0.18em', color: 'rgba(0,186,220,0.55)', textTransform: 'uppercase', margin: 0 }}>
              People
            </h1>
          </div>
          <div style={{ fontSize: 11, color: '#527e96', fontWeight: 300 }}>
            {people.length} contacts · {stale.length} stale
          </div>
        </div>
        <button
          onClick={() => setAddingPerson(v => !v)}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.12em',
            color: '#00badc', background: 'rgba(0,186,220,0.06)',
            border: '1px solid rgba(0,186,220,0.2)', borderRadius: 2,
            padding: '5px 12px', cursor: 'pointer',
          }}
        >
          + PERSON
        </button>
      </div>

      {/* Alert banners */}
      {stale.length > 0 && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: 'rgba(230,126,34,0.05)',
          border: '1px solid rgba(230,126,34,0.2)',
          borderRadius: 3,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ color: '#e67e22', fontSize: 11 }}>△</span>
          <span style={{ fontSize: 12, color: '#b8925a', fontWeight: 300 }}>
            {stale.length} contact{stale.length > 1 ? 's' : ''} haven't heard from you in 30+ days:&nbsp;
            <span style={{ color: '#e67e22' }}>
              {stale.slice(0, 4).map(p => p.name).join(', ')}{stale.length > 4 ? `…+${stale.length - 4}` : ''}
            </span>
          </span>
        </div>
      )}

      {hasOverdueCommitments && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: 'rgba(192,57,43,0.05)',
          border: '1px solid rgba(192,57,43,0.2)',
          borderRadius: 3,
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <span style={{ color: '#c0392b', fontSize: 11 }}>!</span>
          <span style={{ fontSize: 12, color: '#a85c55', fontWeight: 300 }}>
            You have overdue commitments — expand contacts below to resolve them.
          </span>
        </div>
      )}

      {/* Add person form */}
      {addingPerson && (
        <div style={{ marginBottom: 16 }}>
          <AddPersonForm onDone={() => setAddingPerson(false)} />
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, flexWrap: 'wrap' }}>
        {(['all', ...Object.keys(REL_LABELS)] as const).map(k => (
          <button
            key={k}
            onClick={() => setFilter(k as RelationshipType | 'all')}
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.1em',
              color: filter === k ? '#00badc' : '#527e96',
              background: filter === k ? 'rgba(0,186,220,0.08)' : 'transparent',
              border: `1px solid ${filter === k ? 'rgba(0,186,220,0.25)' : 'rgba(0,186,220,0.06)'}`,
              borderRadius: 2, padding: '3px 9px', cursor: 'pointer', textTransform: 'uppercase',
            }}
          >
            {k === 'all' ? 'ALL' : REL_LABELS[k as RelationshipType]}
          </button>
        ))}
      </div>

      {/* People list */}
      {isLoading ? (
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#2c526a', letterSpacing: '0.08em', padding: '20px 0' }}>
          LOADING...
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0' }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: '#2c526a', letterSpacing: '0.1em' }}>
            {filter === 'all' ? 'NO CONTACTS YET' : `NO ${filter.toUpperCase()}S`}
          </div>
          {filter === 'all' && (
            <div style={{ fontSize: 12, color: '#1e3a52', marginTop: 8, fontWeight: 300 }}>
              Add people you want to stay connected with.
            </div>
          )}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(p => (
            <PersonCard key={p.id} person={p} />
          ))}
        </div>
      )}
    </div>
  )
}
