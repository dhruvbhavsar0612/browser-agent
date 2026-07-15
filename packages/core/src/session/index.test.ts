import { describe, expect, it } from 'vitest'
import { MemorySessionStore } from './index.js'

describe('MemorySessionStore', () => {
  it('creates sessions and reconstructs transcript', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse', title: 'Demo' })
    const user = await store.appendMessage({ sessionId: session.id, role: 'user' })
    await store.appendPart({ messageId: user.id, type: 'text', content: 'hello' })
    const assistant = await store.appendMessage({ sessionId: session.id, role: 'assistant' })
    await store.appendPart({ messageId: assistant.id, type: 'text', content: 'world' })

    const transcript = await store.getTranscript(session.id)
    expect(transcript).toHaveLength(2)
    expect(transcript[0]?.parts[0]?.content).toBe('hello')
    expect(transcript[1]?.parts[0]?.content).toBe('world')

    const listed = await store.listSessions()
    expect(listed[0]?.id).toBe(session.id)
  })

  it('deletes session and related records', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'act' })
    const msg = await store.appendMessage({ sessionId: session.id, role: 'user' })
    await store.appendPart({ messageId: msg.id, type: 'text', content: 'x' })
    await store.deleteSession(session.id)
    expect(await store.getSession(session.id)).toBeNull()
    expect(await store.getTranscript(session.id)).toEqual([])
  })

  it('updates session title', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse', title: 'Old' })
    const updated = await store.updateSession(session.id, { title: 'Renamed chat' })
    expect(updated?.title).toBe('Renamed chat')
    expect((await store.getSession(session.id))?.title).toBe('Renamed chat')
  })

  it('uses explicit part order without requiring a database migration', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse' })
    const message = await store.appendMessage({ sessionId: session.id, role: 'assistant' })
    await store.appendPart({
      id: 'second',
      messageId: message.id,
      type: 'text',
      content: 'second',
      order: 1,
    })
    await store.appendPart({
      id: 'first',
      messageId: message.id,
      type: 'text',
      content: 'first',
      order: 0,
    })

    expect((await store.listParts(message.id)).map((part) => part.id)).toEqual(['first', 'second'])
  })

  it('persists a model pin independently per session', async () => {
    const store = new MemorySessionStore()
    const first = await store.createSession({ agent: 'browse', model: 'openai/gpt-a' })
    const second = await store.createSession({ agent: 'browse', model: 'openai/gpt-b' })
    await store.updateSession(first.id, { model: 'anthropic/claude-a' })
    expect((await store.getSession(first.id))?.model).toBe('anthropic/claude-a')
    expect((await store.getSession(second.id))?.model).toBe('openai/gpt-b')
  })
})
