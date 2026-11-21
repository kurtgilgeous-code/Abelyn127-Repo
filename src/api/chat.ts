export type ChatRole = 'user' | 'assistant'

export interface ChatTurn {
  role: ChatRole
  content: string
}

// Mirrors the server limits in server/src/geraint.ts.
const MAX_MESSAGES = 20
const MAX_ASSISTANT_LENGTH = 1500
const MAX_TOTAL_LENGTH = 5000
export const MAX_USER_MESSAGE_LENGTH = 1000

/** Keeps the most recent turns that fit the server's limits, starting with a user turn. */
function trimHistory(turns: ChatTurn[]) {
  const kept: ChatTurn[] = []
  let total = 0
  for (let index = turns.length - 1; index >= 0 && kept.length < MAX_MESSAGES; index -= 1) {
    const turn = turns[index]
    const content = turn.role === 'assistant' ? turn.content.trim().slice(0, MAX_ASSISTANT_LENGTH) : turn.content.trim()
    total += content.length
    if (total > MAX_TOTAL_LENGTH) break
    kept.unshift({ role: turn.role, content })
  }
  while (kept.length && kept[0].role === 'assistant') kept.shift()
  return kept
}

export async function askGeraint(turns: ChatTurn[], signal?: AbortSignal) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: trimHistory(turns) }),
    signal,
  })
  let body: unknown = null
  try {
    body = await response.json()
  } catch {
    body = null
  }
  const record = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
  if (!response.ok) {
    throw new Error(typeof record.message === 'string'
      ? record.message
      : 'Geraint could not reply right now. Please try again in a moment.')
  }
  if (typeof record.reply !== 'string' || !record.reply.trim()) {
    throw new Error('Geraint could not reply right now. Please try again in a moment.')
  }
  return record.reply.trim()
}
