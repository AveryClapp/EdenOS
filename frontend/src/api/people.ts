import type { Person, Commitment, RelationshipType, GoalTreePayload, GoalTreeResult } from '../types'

const BASE = '/api'

// People

export async function listPeople(staleDays?: number): Promise<Person[]> {
  const url = staleDays != null
    ? `${BASE}/people?stale_days=${staleDays}`
    : `${BASE}/people`
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load people')
  return res.json()
}

export async function getPerson(id: string): Promise<Person> {
  const res = await fetch(`${BASE}/people/${id}`)
  if (!res.ok) throw new Error('Failed to load person')
  return res.json()
}

export async function createPerson(data: {
  name: string
  relationship_type: RelationshipType
  context?: string
  notes?: string
}): Promise<Person> {
  const res = await fetch(`${BASE}/people`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create person')
  return res.json()
}

export async function updatePerson(id: string, data: Partial<{
  name: string
  relationship_type: RelationshipType
  context: string
  notes: string
  is_active: boolean
}>): Promise<Person> {
  const res = await fetch(`${BASE}/people/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update person')
  return res.json()
}

export async function deletePerson(id: string): Promise<void> {
  const res = await fetch(`${BASE}/people/${id}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete person')
}

export async function logContact(personId: string): Promise<Person> {
  const res = await fetch(`${BASE}/people/${personId}/contact`, { method: 'POST' })
  if (!res.ok) throw new Error('Failed to log contact')
  return res.json()
}

// Commitments

export async function createCommitment(personId: string, data: {
  description: string
  due_date?: string
}): Promise<Commitment> {
  const res = await fetch(`${BASE}/people/${personId}/commitments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to create commitment')
  return res.json()
}

export async function updateCommitment(commitmentId: string, data: {
  status?: 'open' | 'done' | 'dropped'
  description?: string
  due_date?: string
}): Promise<Commitment> {
  const res = await fetch(`${BASE}/commitments/${commitmentId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!res.ok) throw new Error('Failed to update commitment')
  return res.json()
}

export async function deleteCommitment(commitmentId: string): Promise<void> {
  const res = await fetch(`${BASE}/commitments/${commitmentId}`, { method: 'DELETE' })
  if (!res.ok) throw new Error('Failed to delete commitment')
}

// Goal tree decomposition

export async function commitGoalTree(payload: GoalTreePayload): Promise<GoalTreeResult> {
  const res = await fetch(`${BASE}/decompose/goal-tree`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error('Failed to commit goal tree')
  return res.json()
}
