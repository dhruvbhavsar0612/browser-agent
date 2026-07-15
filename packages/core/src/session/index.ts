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
  order?: number
}

export interface PermissionApprovalRecord {
  id: string
  sessionId: string
  permission: string
  pattern: string
  action: 'allow' | 'deny'
  createdAt: number
}

export interface CompactionRecord {
  id: string
  sessionId: string
  epoch: number
  summary: string
  compactedThroughMessageId: string
  sourceModel?: string
  estimatedTokensBefore: number
  estimatedTokensAfter: number
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
  compactions: {
    key: string
    value: CompactionRecord
    indexes: { 'by-session': string }
  }
}

const DB_NAME = 'browser-agent'
const DB_VERSION = 2

async function openDatabase(): Promise<IDBPDatabase<BrowserAgentDB>> {
  return openDB<BrowserAgentDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const sessions = db.createObjectStore('sessions', { keyPath: 'id' })
        sessions.createIndex('by-updated', 'updatedAt')

        const messages = db.createObjectStore('messages', { keyPath: 'id' })
        messages.createIndex('by-session', 'sessionId')

        const parts = db.createObjectStore('parts', { keyPath: 'id' })
        parts.createIndex('by-message', 'messageId')

        const permissions = db.createObjectStore('permissions', { keyPath: 'id' })
        permissions.createIndex('by-session', 'sessionId')
      }

      if (oldVersion < 2) {
        const compactions = db.createObjectStore('compactions', { keyPath: 'id' })
        compactions.createIndex('by-session', 'sessionId')
      }
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
  appendMessage(
    input: Omit<MessageRecord, 'id' | 'createdAt'> & { id?: string },
  ): Promise<MessageRecord>
  appendPart(input: Omit<PartRecord, 'id' | 'createdAt'> & { id?: string }): Promise<PartRecord>
  listMessages(sessionId: string): Promise<MessageRecord[]>
  listParts(messageId: string): Promise<PartRecord[]>
  getTranscript(sessionId: string): Promise<Array<MessageRecord & { parts: PartRecord[] }>>
  saveCompaction(
    input: Omit<CompactionRecord, 'id' | 'epoch' | 'createdAt'>,
  ): Promise<CompactionRecord>
  getLatestCompaction(sessionId: string): Promise<CompactionRecord | null>
  listCompactions(sessionId: string): Promise<CompactionRecord[]>
  deleteSession(id: string): Promise<void>
}

export class IndexedDbSessionStore implements SessionStore {
  private dbPromise = openDatabase()
  private lastCreatedAt = 0

  private async db() {
    return this.dbPromise
  }

  private nextCreatedAt(): number {
    this.lastCreatedAt = Math.max(Date.now(), this.lastCreatedAt + 1)
    return this.lastCreatedAt
  }

  async createSession(input: {
    title?: string
    agent: string
    model?: string
  }): Promise<SessionRecord> {
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
      createdAt: this.nextCreatedAt(),
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

  async appendPart(
    input: Omit<PartRecord, 'id' | 'createdAt'> & { id?: string },
  ): Promise<PartRecord> {
    const db = await this.db()
    const existing = await db.getAllFromIndex('parts', 'by-message', input.messageId)
    const record: PartRecord = {
      id: input.id ?? crypto.randomUUID(),
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      createdAt: this.nextCreatedAt(),
      order: existing.reduce((max, part) => Math.max(max, part.order ?? 0), 0) + 1,
    }
    await db.put('parts', record)
    return record
  }

  async listMessages(sessionId: string): Promise<MessageRecord[]> {
    const messages = await (await this.db()).getAllFromIndex('messages', 'by-session', sessionId)
    return messages.sort((a, b) => a.createdAt - b.createdAt)
  }

  async listParts(messageId: string): Promise<PartRecord[]> {
    const parts = await (await this.db()).getAllFromIndex('parts', 'by-message', messageId)
    return parts.sort((a, b) =>
      a.order !== undefined && b.order !== undefined
        ? a.order - b.order
        : a.createdAt - b.createdAt,
    )
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

  async saveCompaction(
    input: Omit<CompactionRecord, 'id' | 'epoch' | 'createdAt'>,
  ): Promise<CompactionRecord> {
    const db = await this.db()
    const existing = await db.getAllFromIndex('compactions', 'by-session', input.sessionId)
    const record: CompactionRecord = {
      ...input,
      id: crypto.randomUUID(),
      epoch: existing.reduce((max, item) => Math.max(max, item.epoch), 0) + 1,
      createdAt: this.nextCreatedAt(),
    }
    await db.put('compactions', record)
    return record
  }

  async getLatestCompaction(sessionId: string): Promise<CompactionRecord | null> {
    return (await this.listCompactions(sessionId)).at(-1) ?? null
  }

  async listCompactions(sessionId: string): Promise<CompactionRecord[]> {
    const records = await (await this.db()).getAllFromIndex('compactions', 'by-session', sessionId)
    return records.sort((a, b) => a.epoch - b.epoch)
  }

  async deleteSession(id: string): Promise<void> {
    const db = await this.db()
    const messages = await db.getAllFromIndex('messages', 'by-session', id)
    const partIds = (
      await Promise.all(
        messages.map(async (message) =>
          (await db.getAllFromIndex('parts', 'by-message', message.id)).map((part) => part.id),
        ),
      )
    ).flat()
    const perms = await db.getAllFromIndex('permissions', 'by-session', id)
    const compactions = await db.getAllFromIndex('compactions', 'by-session', id)
    const tx = db.transaction(
      ['sessions', 'messages', 'parts', 'permissions', 'compactions'],
      'readwrite',
    )
    await tx.objectStore('sessions').delete(id)
    for (const message of messages) {
      await tx.objectStore('messages').delete(message.id)
    }
    for (const partId of partIds) {
      await tx.objectStore('parts').delete(partId)
    }
    for (const perm of perms) {
      await tx.objectStore('permissions').delete(perm.id)
    }
    for (const compaction of compactions) {
      await tx.objectStore('compactions').delete(compaction.id)
    }
    await tx.done
  }
}

/** In-memory store for Node/unit tests */
export class MemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionRecord>()
  private messages = new Map<string, MessageRecord>()
  private parts = new Map<string, PartRecord>()
  private compactions = new Map<string, CompactionRecord>()
  private lastCreatedAt = 0

  private nextCreatedAt(): number {
    this.lastCreatedAt = Math.max(Date.now(), this.lastCreatedAt + 1)
    return this.lastCreatedAt
  }

  async createSession(input: {
    title?: string
    agent: string
    model?: string
  }): Promise<SessionRecord> {
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
      createdAt: this.nextCreatedAt(),
    }
    this.messages.set(record.id, record)
    const session = this.sessions.get(input.sessionId)
    if (session) this.sessions.set(session.id, { ...session, updatedAt: Date.now() })
    return record
  }

  async appendPart(
    input: Omit<PartRecord, 'id' | 'createdAt'> & { id?: string },
  ): Promise<PartRecord> {
    const order =
      [...this.parts.values()]
        .filter((part) => part.messageId === input.messageId)
        .reduce((max, part) => Math.max(max, part.order ?? 0), 0) + 1
    const record: PartRecord = {
      id: input.id ?? crypto.randomUUID(),
      messageId: input.messageId,
      type: input.type,
      content: input.content,
      createdAt: this.nextCreatedAt(),
      order,
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
      .sort((a, b) =>
        a.order !== undefined && b.order !== undefined
          ? a.order - b.order
          : a.createdAt - b.createdAt,
      )
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

  async saveCompaction(
    input: Omit<CompactionRecord, 'id' | 'epoch' | 'createdAt'>,
  ): Promise<CompactionRecord> {
    const existing = await this.listCompactions(input.sessionId)
    const record: CompactionRecord = {
      ...input,
      id: crypto.randomUUID(),
      epoch: (existing.at(-1)?.epoch ?? 0) + 1,
      createdAt: this.nextCreatedAt(),
    }
    this.compactions.set(record.id, record)
    return record
  }

  async getLatestCompaction(sessionId: string): Promise<CompactionRecord | null> {
    return (await this.listCompactions(sessionId)).at(-1) ?? null
  }

  async listCompactions(sessionId: string): Promise<CompactionRecord[]> {
    return [...this.compactions.values()]
      .filter((record) => record.sessionId === sessionId)
      .sort((a, b) => a.epoch - b.epoch)
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
    for (const [compactionId, compaction] of this.compactions) {
      if (compaction.sessionId === id) this.compactions.delete(compactionId)
    }
  }
}
