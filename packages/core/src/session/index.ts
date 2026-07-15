import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface SessionRecord {
  id: string
  title: string
  agent: string
  model?: string
  createdAt: number
  updatedAt: number
}

export interface MessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  createdAt: number
}

export interface PartRecord {
  id: string
  messageId: string
  type: 'text' | 'tool-call' | 'tool-result' | 'reasoning'
  content: unknown
  createdAt: number
}

export interface PermissionApprovalRecord {
  id: string
  sessionId: string
  permission: string
  pattern: string
  action: 'allow' | 'deny'
  createdAt: number
}

interface BrowserAgentDB extends DBSchema {
  sessions: {
    key: string
    value: SessionRecord
    indexes: { 'by-updated': number }
  }
  messages: {
    key: string
    value: MessageRecord
    indexes: { 'by-session': string }
  }
  parts: {
    key: string
    value: PartRecord
    indexes: { 'by-message': string }
  }
  permissions: {
    key: string
    value: PermissionApprovalRecord
    indexes: { 'by-session': string }
  }
}

const DB_NAME = 'browser-agent'
const DB_VERSION = 1

async function openDatabase(): Promise<IDBPDatabase<BrowserAgentDB>> {
  return openDB<BrowserAgentDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
      sessions.createIndex('by-updated', 'updatedAt')

      const messages = db.createObjectStore('messages', { keyPath: 'id' })
      messages.createIndex('by-session', 'sessionId')

      const parts = db.createObjectStore('parts', { keyPath: 'id' })
      parts.createIndex('by-message', 'messageId')

      const permissions = db.createObjectStore('permissions', { keyPath: 'id' })
      permissions.createIndex('by-session', 'sessionId')
    },
  })
}

export interface SessionStore {
  createSession(input: { title?: string; agent: string; model?: string }): Promise<SessionRecord>
  listSessions(): Promise<SessionRecord[]>
  getSession(id: string): Promise<SessionRecord | null>
  updateSession(
    id: string,
    patch: { title?: string; agent?: string; model?: string },
  ): Promise<SessionRecord | null>
  appendMessage(input: Omit<MessageRecord, 'id' | 'createdAt'> & { id?: string }): Promise<MessageRecord>
  appendPart(input: Omit<PartRecord, 'id' | 'createdAt'> & { id?: string }): Promise<PartRecord>
  listMessages(sessionId: string): Promise<MessageRecord[]>
  listParts(messageId: string): Promise<PartRecord[]>
  getTranscript(sessionId: string): Promise<Array<MessageRecord & { parts: PartRecord[] }>>
  deleteSession(id: string): Promise<void>
}

export class IndexedDbSessionStore implements SessionStore {
  private dbPromise = openDatabase()

  private async db() {
    return this.dbPromise
  }

  async createSession(input: { title?: string; agent: string; model?: string }): Promise<SessionRecord> {
    const now = Date.now()
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: input.title?.trim() || 'New session',
      agent: input.agent,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    }
    await (await this.db()).put('sessions', record)
    return record
  }

  async listSessions(): Promise<SessionRecord[]> {
    const all = await (await this.db()).getAllFromIndex('sessions', 'by-updated')
    return all.reverse()
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return (await (await this.db()).get('sessions', id)) ?? null
  }

  async updateSession(
    id: string,
    patch: { title?: string; agent?: string; model?: string },
  ): Promise<SessionRecord | null> {
    const db = await this.db()
    const existing = await db.get('sessions', id)
    if (!existing) return null
    const next: SessionRecord = {
      ...existing,
      title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
      agent: patch.agent ?? existing.agent,
      model: patch.model !== undefined ? patch.model : existing.model,
      updatedAt: Date.now(),
    }
    await db.put('sessions', next)
    return next
  }

  async appendMessage(
    input: Omit<MessageRecord, 'id' | 'createdAt'> & { id?: string },
  ): Promise<MessageRecord> {
    const record: MessageRecord = {
      id: input.id ?? crypto.randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      createdAt: Date.now(),
    }
    const db = await this.db()
    const tx = db.transaction(['messages', 'sessions'], 'readwrite')
    await tx.objectStore('messages').put(record)
    const session = await tx.objectStore('sessions').get(input.sessionId)
    if (session) {
      await tx.objectStore('sessions').put({ ...session, updatedAt: Date.now() })
    }
    await tx.done
    return record
  }

  async appendPart(input: Omit<PartRecord, 'id' | 'createdAt'> & { id?: string }): Promise<PartRecord> {
    const record: PartRecord = {
      id: input.id ?? crypto.randomUUID(),
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      createdAt: Date.now(),
    }
    await (await this.db()).put('parts', record)
    return record
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    const messages = await (await this.db()).getAllFromIndex('messages', 'by-session', sessionId)
    return messages.sort((a, b) => a.createdAt - b.createdAt)
  }

  async listParts(messageId: string): Promise<PartRecord[]> {
    const parts = await (await this.db()).getAllFromIndex('parts', 'by-message', messageId)
    return parts.sort((a, b) => a.createdAt - b.createdAt)
  }

  async getTranscript(sessionId: string): Promise<Array<MessageRecord & { parts: PartRecord[] }>> {
    const messages = await this.listMessages(sessionId)
    return Promise.all(
      messages.map(async (message) => ({
        ...message,
        parts: await this.listParts(message.id),
      })),
    )
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db()
    const messages = await db.getAllFromIndex('messages', 'by-session', id)
    const tx = db.transaction(['sessions', 'messages', 'parts', 'permissions'], 'readwrite')
    await tx.objectStore('sessions').delete(id)
    for (const message of messages) {
      await tx.objectStore('messages').delete(message.id)
      const parts = await db.getAllFromIndex('parts', 'by-message', message.id)
      for (const part of parts) {
        await tx.objectStore('parts').delete(part.id)
      }
    }
    const perms = await db.getAllFromIndex('permissions', 'by-session', id)
    for (const perm of perms) {
      await tx.objectStore('permissions').delete(perm.id)
    }
    await tx.done
  }
}

/** In-memory store for Node/unit tests */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>()
  private messages = new Map<string, MessageRecord>()
  private parts = new Map<string, PartRecord>()

  async createSession(input: { title?: string; agent: string; model?: string }): Promise<SessionRecord> {
    const now = Date.now()
    const record: SessionRecord = {
      id: crypto.randomUUID(),
      title: input.title?.trim() || 'New session',
      agent: input.agent,
      model: input.model,
      createdAt: now,
      updatedAt: now,
    }
    this.sessions.set(record.id, record)
    return record
  }

  async listSessions(): Promise<SessionRecord[]> {
    return [...this.sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async getSession(id: string): Promise<SessionRecord | null> {
    return this.sessions.get(id) ?? null
  }

  async updateSession(
    id: string,
    patch: { title?: string; agent?: string; model?: string },
  ): Promise<SessionRecord | null> {
    const existing = this.sessions.get(id)
    if (!existing) return null
    const next: SessionRecord = {
      ...existing,
      title: patch.title !== undefined ? patch.title.trim() || existing.title : existing.title,
      agent: patch.agent ?? existing.agent,
      model: patch.model !== undefined ? patch.model : existing.model,
      updatedAt: Date.now(),
    }
    this.sessions.set(id, next)
    return next
  }

  async appendMessage(
    input: Omit<MessageRecord, 'id' | 'createdAt'> & { id?: string },
  ): Promise<MessageRecord> {
    const record: MessageRecord = {
      id: input.id ?? crypto.randomUUID(),
      sessionId: input.sessionId,
      role: input.role,
      createdAt: Date.now(),
    }
    this.messages.set(record.id, record)
    const session = this.sessions.get(input.sessionId)
    if (session) this.sessions.set(session.id, { ...session, updatedAt: Date.now() })
    return record
  }

  async appendPart(input: Omit<PartRecord, 'id' | 'createdAt'> & { id?: string }): Promise<PartRecord> {
    const record: PartRecord = {
      id: input.id ?? crypto.randomUUID(),
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      createdAt: Date.now(),
    }
    this.parts.set(record.id, record)
    return record
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    return [...this.messages.values()]
      .filter((m) => m.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async listParts(messageId: string): Promise<PartRecord[]> {
    return [...this.parts.values()]
      .filter((p) => p.messageId === messageId)
      .sort((a, b) => a.createdAt - b.createdAt)
  }

  async getTranscript(sessionId: string): Promise<Array<MessageRecord & { parts: PartRecord[] }>> {
    const messages = await this.listMessages(sessionId)
    return Promise.all(
      messages.map(async (message) => ({
        ...message,
        parts: await this.listParts(message.id),
      })),
    )
  }

  async deleteSession(id: string): Promise<void> {
    this.sessions.delete(id)
    for (const [mid, message] of this.messages) {
      if (message.sessionId !== id) continue
      this.messages.delete(mid)
      for (const [pid, part] of this.parts) {
        if (part.messageId === mid) this.parts.delete(pid)
      }
    }
  }
}
