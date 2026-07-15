import type {
  AssistantModelMessage,
  ModelMessage,
  TextPart,
  ToolCallPart,
  ToolResultPart,
} from 'ai'
import type { CompactionConfig } from '../config/schema.js'
import type { CompactionRecord, MessageRecord, PartRecord, SessionStore } from '../session/index.js'

export type TranscriptMessage = MessageRecord & { parts: PartRecord[] }

export type ContextBudget = {
  contextTokens: number
  reserveTokens: number
  triggerInputTokens: number
  usedFallback: boolean
}

export type CompactionStatus =
  | { status: 'started'; estimatedTokens: number; contextTokens: number }
  | { status: 'failed'; message: string }
  | {
      status: 'completed'
      epoch: number
      compactedMessages: number
      estimatedTokens: number
    }

export type PreparedSessionPrompt = {
  messages: ModelMessage[]
  summary?: string
  compaction: CompactionRecord | null
  estimatedTokens: number
  budget: ContextBudget
  compacted: boolean
}

type ToolCallRecord = {
  toolCallId: string
  toolName: string
  args: unknown
}

type ToolResultRecord = {
  toolCallId: string
  result: unknown
}

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g
const ERROR_KEY_PATTERN = /(?:error|message|reason|status)/i

function safeSerialize(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value)
    return serialized === undefined ? String(value) : serialized
  } catch {
    return String(value)
  }
}

function collectImportantFields(value: unknown): { urls: string[]; errors: string[] } {
  const urls = new Set<string>()
  const errors = new Set<string>()
  const seen = new Set<object>()
  let visited = 0

  const visit = (item: unknown, key?: string): void => {
    if (visited >= 500) return
    visited += 1

    if (typeof item === 'string') {
      for (const url of item.match(URL_PATTERN) ?? []) urls.add(url)
      if (key && ERROR_KEY_PATTERN.test(key) && item.trim()) errors.add(item.slice(0, 1_000))
      return
    }
    if (!item || typeof item !== 'object' || seen.has(item)) return
    seen.add(item)
    if (Array.isArray(item)) {
      for (const child of item.slice(0, 100)) visit(child, key)
      return
    }
    for (const [childKey, child] of Object.entries(item).slice(0, 100)) {
      visit(child, childKey)
    }
  }

  visit(value)
  return { urls: [...urls].slice(0, 20), errors: [...errors].slice(0, 20) }
}

/**
 * Deterministically caps oversized tool data while retaining a preview and
 * high-value navigation/failure details.
 */
export function capToolValue(value: unknown, maxChars: number): unknown {
  const serialized = safeSerialize(value)
  if (serialized.length <= maxChars) return value
  const important = collectImportantFields(value)
  return {
    truncated: true,
    originalChars: serialized.length,
    preview: serialized.slice(0, Math.max(500, maxChars - 2_000)),
    ...(important.urls.length ? { urls: important.urls } : {}),
    ...(important.errors.length ? { errors: important.errors } : {}),
  }
}

function parseToolCall(part: PartRecord): ToolCallRecord | null {
  if (part.type !== 'tool-call' || !part.content || typeof part.content !== 'object') return null
  const value = part.content as Partial<ToolCallRecord>
  if (!value.toolCallId || !value.toolName) return null
  return {
    toolCallId: value.toolCallId,
    toolName: value.toolName,
    args: value.args,
  }
}

function parseToolResult(part: PartRecord): ToolResultRecord | null {
  if (part.type !== 'tool-result' || !part.content || typeof part.content !== 'object') return null
  const value = part.content as Partial<ToolResultRecord>
  if (!value.toolCallId || !('result' in value)) return null
  return { toolCallId: value.toolCallId, result: value.result }
}

function textFromParts(parts: PartRecord[]): string {
  return parts
    .filter(
      (part): part is PartRecord & { type: 'text'; content: string } =>
        part.type === 'text' && typeof part.content === 'string',
    )
    .map((part) => part.content)
    .join('')
}

function toolOutput(result: unknown): ToolResultPart['output'] {
  if (typeof result === 'string') return { type: 'text', value: result }
  try {
    return { type: 'json', value: JSON.parse(JSON.stringify(result)) }
  } catch {
    return { type: 'text', value: String(result) }
  }
}

function appendMessage(messages: ModelMessage[], message: ModelMessage): void {
  if (typeof message.content === 'string' && !message.content) return
  if (Array.isArray(message.content) && message.content.length === 0) return

  const previous = messages.at(-1)
  if (
    previous?.role === message.role &&
    (message.role === 'user' || message.role === 'system') &&
    typeof previous.content === 'string' &&
    typeof message.content === 'string'
  ) {
    previous.content = `${previous.content}\n\n${message.content}`
    return
  }
  messages.push(message)
}

/**
 * Reconstructs provider messages from durable ordered parts. Reasoning parts
 * are intentionally ignored. A tool call or result is replayed only when its
 * matching counterpart exists in the selected transcript.
 */
export function transcriptToModelMessages(
  transcript: TranscriptMessage[],
  options?: { maxToolResultChars?: number },
): ModelMessage[] {
  const maxToolResultChars = options?.maxToolResultChars ?? 12_000
  const calls = new Map<string, ToolCallRecord>()
  const results = new Set<string>()

  for (const message of transcript) {
    for (const part of message.parts) {
      const call = parseToolCall(part)
      if (call && !calls.has(call.toolCallId)) calls.set(call.toolCallId, call)
      const result = parseToolResult(part)
      if (result) results.add(result.toolCallId)
    }
  }
  const completeIds = new Set([...calls.keys()].filter((id) => results.has(id)))
  const messages: ModelMessage[] = []

  for (const row of transcript) {
    if (row.role === 'user' || row.role === 'system') {
      const text = textFromParts(row.parts)
      if (text) appendMessage(messages, { role: row.role, content: text })
      continue
    }

    let assistantContent: Array<TextPart | ToolCallPart> = []
    let toolContent: ToolResultPart[] = []

    const flushAssistant = () => {
      if (!assistantContent.length) return
      appendMessage(messages, { role: 'assistant', content: assistantContent })
      assistantContent = []
    }
    const flushTools = () => {
      if (!toolContent.length) return
      appendMessage(messages, { role: 'tool', content: toolContent })
      toolContent = []
    }

    for (const part of row.parts) {
      if (part.type === 'reasoning') continue
      if (part.type === 'text' && typeof part.content === 'string' && row.role === 'assistant') {
        flushTools()
        if (part.content) {
          const previous = assistantContent.at(-1)
          if (previous?.type === 'text') previous.text += part.content
          else assistantContent.push({ type: 'text', text: part.content })
        }
        continue
      }

      const call = parseToolCall(part)
      if (call && completeIds.has(call.toolCallId)) {
        flushTools()
        assistantContent.push({
          type: 'tool-call',
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: capToolValue(call.args, Math.max(1_000, Math.floor(maxToolResultChars / 2))),
        })
        continue
      }

      const result = parseToolResult(part)
      const pairedCall = result ? calls.get(result.toolCallId) : undefined
      if (result && pairedCall && completeIds.has(result.toolCallId)) {
        flushAssistant()
        toolContent.push({
          type: 'tool-result',
          toolCallId: result.toolCallId,
          toolName: pairedCall.toolName,
          output: toolOutput(capToolValue(result.result, maxToolResultChars)),
        })
      }
    }

    flushAssistant()
    flushTools()
  }

  return messages
}

function contentChars(message: ModelMessage): number {
  if (typeof message.content === 'string') return message.content.length
  return message.content.reduce((total, part) => total + safeSerialize(part).length, 0)
}

/** Conservative tokenizer-independent estimate suitable for preflight checks. */
export function estimateModelMessageTokens(messages: ModelMessage[], system?: string): number {
  let tokens = system ? Math.ceil(system.length / 4) + 4 : 0
  for (const message of messages) {
    tokens += 5 + Math.ceil(contentChars(message) / 4)
    if (Array.isArray(message.content)) tokens += message.content.length * 3
  }
  return tokens
}

export function resolveContextBudget(
  discoveredContext: number | undefined,
  config: Pick<CompactionConfig, 'fallbackContextTokens' | 'reserveTokens' | 'threshold'>,
): ContextBudget {
  const usedFallback = !discoveredContext || discoveredContext <= 0
  const contextTokens = usedFallback ? config.fallbackContextTokens : Math.floor(discoveredContext)
  const reserveTokens = Math.min(config.reserveTokens, Math.floor(contextTokens * 0.25))
  return {
    contextTokens,
    reserveTokens,
    triggerInputTokens: Math.max(1, Math.floor(contextTokens * config.threshold) - reserveTokens),
    usedFallback,
  }
}

function compactionStartIndex(
  transcript: TranscriptMessage[],
  compaction: CompactionRecord | null,
): number {
  if (!compaction) return 0
  const index = transcript.findIndex(
    (message) => message.id === compaction.compactedThroughMessageId,
  )
  return index < 0 ? 0 : index + 1
}

export function buildSessionPrompt(
  transcript: TranscriptMessage[],
  newestUserMessage: string | undefined,
  compaction: CompactionRecord | null,
  maxToolResultChars = 12_000,
): { messages: ModelMessage[]; summary?: string } {
  const start = compactionStartIndex(transcript, compaction)
  const messages = transcriptToModelMessages(transcript.slice(start), { maxToolResultChars })
  if (newestUserMessage?.trim()) {
    messages.push({ role: 'user', content: newestUserMessage.trim() })
  }
  return {
    messages,
    summary: start > 0 ? compaction?.summary : undefined,
  }
}

function turnStartBefore(transcript: TranscriptMessage[], index: number, floor: number): number {
  for (let cursor = index; cursor >= floor; cursor -= 1) {
    if (transcript[cursor]?.role === 'user') return cursor
  }
  return floor
}

/**
 * Returns an end-inclusive message cutoff at a user-turn boundary. If a tool
 * call/result crosses that boundary, the entire chain remains in the suffix.
 */
export function findCompactionCutoff(
  transcript: TranscriptMessage[],
  options: { afterMessageId?: string; recentTurns: number },
): number | null {
  const previousIndex = options.afterMessageId
    ? transcript.findIndex((message) => message.id === options.afterMessageId)
    : -1
  const start = previousIndex + 1
  const turnStarts: number[] = []
  for (let index = start; index < transcript.length; index += 1) {
    if (transcript[index]?.role === 'user') turnStarts.push(index)
  }
  if (turnStarts.length <= options.recentTurns) return null

  const suffixStart = turnStarts[turnStarts.length - options.recentTurns]!
  let cutoff = suffixStart - 1
  const callIndexes = new Map<string, number>()
  const resultIndexes = new Map<string, number>()
  for (let index = start; index < transcript.length; index += 1) {
    for (const part of transcript[index]!.parts) {
      const call = parseToolCall(part)
      if (call && !callIndexes.has(call.toolCallId)) callIndexes.set(call.toolCallId, index)
      const result = parseToolResult(part)
      if (result && !resultIndexes.has(result.toolCallId))
        resultIndexes.set(result.toolCallId, index)
    }
  }

  for (const [toolCallId, callIndex] of callIndexes) {
    const resultIndex = resultIndexes.get(toolCallId)
    if (resultIndex === undefined) continue
    if (
      (callIndex <= cutoff && resultIndex > cutoff) ||
      (resultIndex <= cutoff && callIndex > cutoff)
    ) {
      cutoff = turnStartBefore(transcript, Math.min(callIndex, resultIndex), start) - 1
    }
  }

  return cutoff >= start ? cutoff : null
}

function formatTranscriptForSummary(
  transcript: TranscriptMessage[],
  maxToolResultChars: number,
): string {
  const lines: string[] = []
  const toolNames = new Map<string, string>()
  for (const message of transcript) {
    for (const part of message.parts) {
      if (part.type === 'reasoning') continue
      if (part.type === 'text' && typeof part.content === 'string') {
        lines.push(`${message.role}: ${part.content}`)
        continue
      }
      const call = parseToolCall(part)
      if (call) {
        toolNames.set(call.toolCallId, call.toolName)
        lines.push(
          `assistant tool-call ${call.toolName} (${call.toolCallId}) args=${safeSerialize(
            capToolValue(call.args, Math.max(1_000, Math.floor(maxToolResultChars / 2))),
          )}`,
        )
        continue
      }
      const result = parseToolResult(part)
      if (result) {
        lines.push(
          `tool-result ${toolNames.get(result.toolCallId) ?? 'unknown'} (${result.toolCallId}) result=${safeSerialize(
            capToolValue(result.result, maxToolResultChars),
          )}`,
        )
      }
    }
  }
  return lines.join('\n')
}

async function summarizeWithinContext(
  source: string,
  maxInputChars: number,
  summarize: (input: string) => Promise<string>,
): Promise<string> {
  if (source.length <= maxInputChars) return summarize(source)

  let chunks = Array.from({ length: Math.ceil(source.length / maxInputChars) }, (_, index) =>
    source.slice(index * maxInputChars, (index + 1) * maxInputChars),
  )

  // This is a bounded map/reduce over the summarizer itself, not an agent turn:
  // it cannot persist messages or invoke session compaction recursively.
  for (let round = 0; round < 5; round += 1) {
    const partials: string[] = []
    for (let index = 0; index < chunks.length; index += 1) {
      partials.push(
        (
          await summarize(
            `Conversation summary chunk ${index + 1} of ${chunks.length}:\n${chunks[index]}`,
          )
        ).trim(),
      )
    }
    const combined = partials
      .map((partial, index) => `Partial summary ${index + 1}:\n${partial}`)
      .join('\n\n')
    if (partials.length === 1) return partials[0] ?? ''
    if (combined.length <= maxInputChars) {
      return summarize(`Merge these partial summaries without losing facts:\n${combined}`)
    }
    chunks = Array.from({ length: Math.ceil(combined.length / maxInputChars) }, (_, index) =>
      combined.slice(index * maxInputChars, (index + 1) * maxInputChars),
    )
  }

  throw new Error('Compaction summary did not converge within the model context budget.')
}

export type PrepareSessionPromptOptions = {
  store: SessionStore
  sessionId: string
  newestUserMessage?: string
  discoveredContext?: number
  config: CompactionConfig
  system?: string
  sourceModel?: string
  force?: boolean
  summarize: (input: string) => Promise<string>
  onCompaction?: (status: CompactionStatus) => void
}

export async function prepareSessionPrompt(
  options: PrepareSessionPromptOptions,
): Promise<PreparedSessionPrompt> {
  const transcript = await options.store.getTranscript(options.sessionId)
  const latest = await options.store.getLatestCompaction(options.sessionId)
  const budget = resolveContextBudget(options.discoveredContext, options.config)
  const initial = buildSessionPrompt(
    transcript,
    options.newestUserMessage,
    latest,
    options.config.maxToolResultChars,
  )
  const initialSystem = [options.system, initial.summary].filter(Boolean).join('\n\n')
  const estimatedTokens = estimateModelMessageTokens(initial.messages, initialSystem)

  if (!options.force && estimatedTokens < budget.triggerInputTokens) {
    return {
      ...initial,
      compaction: latest,
      estimatedTokens,
      budget,
      compacted: false,
    }
  }

  const recentTurns = options.force
    ? Math.max(1, Math.floor(options.config.recentTurns / 2))
    : options.config.recentTurns
  const cutoff = findCompactionCutoff(transcript, {
    afterMessageId: latest?.compactedThroughMessageId,
    recentTurns,
  })
  if (cutoff === null) {
    return {
      ...initial,
      compaction: latest,
      estimatedTokens,
      budget,
      compacted: false,
    }
  }

  const start = compactionStartIndex(transcript, latest)
  const compactedSpan = transcript.slice(start, cutoff + 1)
  options.onCompaction?.({
    status: 'started',
    estimatedTokens,
    contextTokens: budget.contextTokens,
  })
  const source = [
    latest?.summary ? `Previous compacted summary:\n${latest.summary}` : '',
    `Transcript span to compact:\n${formatTranscriptForSummary(
      compactedSpan,
      options.config.maxToolResultChars,
    )}`,
  ]
    .filter(Boolean)
    .join('\n\n')
  let summary: string
  try {
    summary = (
      await summarizeWithinContext(
        source,
        Math.max(8_000, Math.floor(budget.contextTokens * 2.5)),
        options.summarize,
      )
    ).trim()
  } catch (error) {
    options.onCompaction?.({
      status: 'failed',
      message: error instanceof Error ? error.message : String(error),
    })
    return {
      ...initial,
      compaction: latest,
      estimatedTokens,
      budget,
      compacted: false,
    }
  }
  if (!summary) {
    return {
      ...initial,
      compaction: latest,
      estimatedTokens,
      budget,
      compacted: false,
    }
  }

  const synthetic: CompactionRecord = {
    id: 'pending',
    sessionId: options.sessionId,
    epoch: (latest?.epoch ?? 0) + 1,
    summary,
    compactedThroughMessageId: transcript[cutoff]!.id,
    sourceModel: options.sourceModel,
    estimatedTokensBefore: estimatedTokens,
    estimatedTokensAfter: 0,
    createdAt: Date.now(),
  }
  const compactedPrompt = buildSessionPrompt(
    transcript,
    options.newestUserMessage,
    synthetic,
    options.config.maxToolResultChars,
  )
  const compactedSystem = [options.system, summary].filter(Boolean).join('\n\n')
  const estimatedTokensAfter = estimateModelMessageTokens(compactedPrompt.messages, compactedSystem)
  if (!options.force && estimatedTokensAfter >= estimatedTokens) {
    return {
      ...initial,
      compaction: latest,
      estimatedTokens,
      budget,
      compacted: false,
    }
  }

  const saved = await options.store.saveCompaction({
    sessionId: options.sessionId,
    summary,
    compactedThroughMessageId: transcript[cutoff]!.id,
    sourceModel: options.sourceModel,
    estimatedTokensBefore: estimatedTokens,
    estimatedTokensAfter,
  })
  options.onCompaction?.({
    status: 'completed',
    epoch: saved.epoch,
    compactedMessages: compactedSpan.length,
    estimatedTokens: estimatedTokensAfter,
  })

  return {
    ...compactedPrompt,
    compaction: saved,
    estimatedTokens: estimatedTokensAfter,
    budget,
    compacted: true,
  }
}

export const COMPACTION_SUMMARY_SYSTEM_PROMPT = `Compact the supplied conversation span into an information-dense durable summary for another agent.
Preserve user goals, constraints, decisions, factual findings, named entities, URLs, errors, tool outcomes, unfinished work, and open questions.
Do not include hidden reasoning or commentary about summarizing. Do not call tools. Do not invent facts.
Prefer concise structured prose.`
