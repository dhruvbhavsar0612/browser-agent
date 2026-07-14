import { evaluate, matchWildcard, type PermissionRuleEntry } from './evaluate.js'
import {
  PermissionDeniedError,
  PermissionNotFoundError,
  PermissionRejectedError,
} from './errors.js'

export type PermissionReply = 'once' | 'always' | 'reject'

export interface PermissionRequest {
  id: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: unknown
}

export interface PermissionAskInput {
  id?: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: unknown
  /** Overrides the engine base ruleset for this call when provided. */
  ruleset?: PermissionRuleEntry[]
}

export interface PermissionReplyInput {
  id: string
  response: PermissionReply
}

export type PermissionAskHandler = (request: PermissionRequest) => void

interface PendingEntry {
  info: PermissionRequest
  resolve: () => void
  reject: (error: Error) => void
}

export interface PermissionEngineOptions {
  ruleset?: PermissionRuleEntry[]
  onAsk?: PermissionAskHandler
}

/**
 * Browser-safe permission engine: evaluate allow/deny/ask, defer asks until reply.
 * Session "Always" approvals are cached for the lifetime of this engine instance.
 */
export class PermissionEngine {
  private readonly baseRuleset: PermissionRuleEntry[]
  /** sessionID → rules added via reply("always") */
  private readonly approved = new Map<string, PermissionRuleEntry[]>()
  private readonly pending = new Map<string, PendingEntry>()
  private onAskHandler: PermissionAskHandler | undefined

  constructor(options: PermissionEngineOptions = {}) {
    this.baseRuleset = options.ruleset ? [...options.ruleset] : []
    this.onAskHandler = options.onAsk
  }

  /** Replace or clear the ask callback (e.g. UI modal listener). */
  onAsk(handler: PermissionAskHandler | undefined): void {
    this.onAskHandler = handler
  }

  getRuleset(): PermissionRuleEntry[] {
    return [...this.baseRuleset]
  }

  /** Session-approved allow rules from prior "Always" replies. */
  getApproved(sessionID: string): PermissionRuleEntry[] {
    return [...(this.approved.get(sessionID) ?? [])]
  }

  listPending(): PermissionRequest[] {
    return Array.from(this.pending.values(), (entry) => ({ ...entry.info }))
  }

  /**
   * Evaluate permission for patterns. Resolves immediately on allow;
   * throws PermissionDeniedError on deny; otherwise waits for reply().
   */
  ask(input: PermissionAskInput): Promise<void> {
    const ruleset = input.ruleset ?? this.baseRuleset
    const sessionApproved = this.approved.get(input.sessionID) ?? []

    let needsAsk = false
    for (const pattern of input.patterns) {
      const rule = evaluate(input.permission, pattern, ruleset, sessionApproved)
      if (rule.action === 'deny') {
        const relevant = [...ruleset, ...sessionApproved].filter((r) =>
          matchWildcard(input.permission, r.permission),
        )
        return Promise.reject(new PermissionDeniedError(input.permission, input.patterns, relevant))
      }
      if (rule.action === 'allow') continue
      needsAsk = true
    }

    if (!needsAsk) return Promise.resolve()

    const id = input.id ?? crypto.randomUUID()
    const info: PermissionRequest = {
      id,
      sessionID: input.sessionID,
      permission: input.permission,
      patterns: [...input.patterns],
      metadata: input.metadata,
    }

    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { info, resolve, reject })
      this.onAskHandler?.(info)
    })
  }

  reply(input: PermissionReplyInput): void {
    const existing = this.pending.get(input.id)
    if (!existing) throw new PermissionNotFoundError(input.id)

    this.pending.delete(input.id)

    if (input.response === 'reject') {
      existing.reject(new PermissionRejectedError())
      return
    }

    if (input.response === 'always') {
      const list = this.approved.get(existing.info.sessionID) ?? []
      for (const pattern of existing.info.patterns) {
        list.push({
          permission: existing.info.permission,
          pattern,
          action: 'allow',
        })
      }
      this.approved.set(existing.info.sessionID, list)

      // Auto-resolve other pending asks in this session that are now fully allowed
      const approved = list
      for (const [id, item] of [...this.pending.entries()]) {
        if (item.info.sessionID !== existing.info.sessionID) continue
        const ok = item.info.patterns.every(
          (pattern) =>
            evaluate(item.info.permission, pattern, this.baseRuleset, approved).action === 'allow',
        )
        if (!ok) continue
        this.pending.delete(id)
        item.resolve()
      }
    }

    existing.resolve()
  }
}
