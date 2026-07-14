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

/** Placeholder — DHR-52 implements IndexedDB persistence */
export interface SessionStore {
  createSession(input: { title?: string; agent: string; model?: string }): Promise<SessionRecord>
  listSessions(): Promise<SessionRecord[]>
  getSession(id: string): Promise<SessionRecord | null>
}
