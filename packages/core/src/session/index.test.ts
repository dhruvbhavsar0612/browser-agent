import { describe, expect, it } from 'vitest'
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbSessionStore, MemorySessionStore } from './index.js'

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

  it('persists ordered compaction epochs and deletes them with the session', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse' })
    const message = await store.appendMessage({ sessionId: session.id, role: 'user' })
    await store.saveCompaction({
      sessionId: session.id,
      summary: 'first',
      compactedThroughMessageId: message.id,
      estimatedTokensBefore: 1_000,
      estimatedTokensAfter: 100,
    })
    await store.saveCompaction({
      sessionId: session.id,
      summary: 'second',
      compactedThroughMessageId: message.id,
      estimatedTokensBefore: 2_000,
      estimatedTokensAfter: 200,
    })

    expect((await store.listCompactions(session.id)).map((item) => item.epoch)).toEqual([1, 2])
    expect((await store.getLatestCompaction(session.id))?.summary).toBe('second')
    await store.deleteSession(session.id)
    expect(await store.listCompactions(session.id)).toEqual([])
  })
})

describe('IndexedDbSessionStore migration', () => {
  it('adds compaction storage when opening a version 1 database', async () => {
    const factory = new IDBFactory()
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: factory,
    })
    await new Promise<void>((resolve, reject) => {
      const request = factory.open('browser-agent', 1)
      request.onupgradeneeded = () => {
        const db = request.result
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
        sessions.createIndex('by-updated', 'updatedAt')
        const messages = db.createObjectStore('messages', { keyPath: 'id' })
        messages.createIndex('by-session', 'sessionId')
        const parts = db.createObjectStore('parts', { keyPath: 'id' })
        parts.createIndex('by-message', 'messageId')
        const permissions = db.createObjectStore('permissions', { keyPath: 'id' })
        permissions.createIndex('by-session', 'sessionId')
      }
      request.onerror = () => reject(request.error)
      request.onsuccess = () => {
        request.result.close()
        resolve()
      }
    })

    const store = new IndexedDbSessionStore()
    const session = await store.createSession({ agent: 'browse' })
    const message = await store.appendMessage({ sessionId: session.id, role: 'user' })
    const compaction = await store.saveCompaction({
      sessionId: session.id,
      summary: 'migrated',
      compactedThroughMessageId: message.id,
      estimatedTokensBefore: 100,
      estimatedTokensAfter: 10,
    })

    expect(compaction.epoch).toBe(1)
    expect((await store.getLatestCompaction(session.id))?.summary).toBe('migrated')
  })
})
