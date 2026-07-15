import type { TextStreamPart, ToolSet } from 'ai'
import type { StreamEvent } from '../messaging/index.js'

export const DEFAULT_TOOL_RESULT_MAX_CHARS = 32_000

/** OpenCode / MiniMax-style tags (primary live format). */
export const THINK_OPEN = '<' + 'think' + '>'
export const THINK_CLOSE = '</' + 'think' + '>'

/** Alternate tags some providers emit. */
const REDACTED_TAG = 'redacted' + '_' + 'thinking'
export const REDACTED_THINK_OPEN = '<' + REDACTED_TAG + '>'
export const REDACTED_THINK_CLOSE = '</' + REDACTED_TAG + '>'

const THINK_OPEN_TAGS = [THINK_OPEN, REDACTED_THINK_OPEN] as const
const THINK_CLOSE_BY_OPEN: Record<string, string> = {
  [THINK_OPEN]: THINK_CLOSE,
  [REDACTED_THINK_OPEN]: REDACTED_THINK_CLOSE,
}

export type DurablePart =
  | { id: string; type: 'text'; content: string }
  | { id: string; type: 'reasoning'; content: string }
  | {
      id: string
      type: 'tool-call'
      content: { toolCallId: string; toolName: string; args: unknown }
    }
  | {
      type: 'tool-result'
      content: { toolCallId: string; segmentId: string; result: unknown }
    }

export type DoomLoopOptions = {
  threshold: number
  onDetect: (info: {
    toolName: string
    args: unknown
    count: number
  }) => Promise<'continue' | 'stop'>
}

export type ProcessFullStreamOptions = {
  onEvent: (event: StreamEvent) => void
  onPart?: (part: DurablePart) => void | Promise<void>
  truncateToolResult?: (result: unknown) => unknown
  doomLoop?: DoomLoopOptions
  abortSignal?: AbortSignal
  createSegmentId?: (type: 'text' | 'reasoning' | 'tool' | 'step') => string
  emitErrors?: boolean
}

export type ProcessFullStreamResult = {
  finishReason?: string
  stopped: boolean
  error?: unknown
}

type ThinkEmit = {
  text: (chunk: string) => void
  reasoning: (chunk: string) => void
}

/**
 * Strips think tags from text deltas into reasoning.
 * Supports both `<think>…</think>` and `<redacted_thinking>…</redacted_thinking>`.
 */
export class ThinkTagParser {
  private mode: 'text' | 'thinking' = 'text'
  private closeTag = THINK_CLOSE
  private partial = ''

  process(chunk: string, emit: ThinkEmit): void {
    let input = this.partial + chunk
    this.partial = ''

    while (input.length > 0) {
      if (this.mode === 'text') {
        const match = findEarliestTag(input, THINK_OPEN_TAGS)
        if (!match) {
          const partialAt = findPartialTagSuffixAny(input, THINK_OPEN_TAGS)
          if (partialAt >= 0) {
            const text = input.slice(0, partialAt)
            if (text) emit.text(text)
            this.partial = input.slice(partialAt)
            return
          }
          emit.text(input)
          return
        }
        const before = input.slice(0, match.index)
        if (before) emit.text(before)
        input = input.slice(match.index + match.tag.length)
        this.closeTag = THINK_CLOSE_BY_OPEN[match.tag] ?? THINK_CLOSE
        this.mode = 'thinking'
        continue
      }

      const idx = input.indexOf(this.closeTag)
      if (idx === -1) {
        const partialAt = findPartialTagSuffix(input, this.closeTag)
        if (partialAt >= 0) {
          const reasoning = input.slice(0, partialAt)
          if (reasoning) emit.reasoning(reasoning)
          this.partial = input.slice(partialAt)
          return
        }
        emit.reasoning(input)
        return
      }
      const inside = input.slice(0, idx)
      if (inside) emit.reasoning(inside)
      input = input.slice(idx + this.closeTag.length)
      this.mode = 'text'
    }
  }

  flush(emit: ThinkEmit): void {
    if (!this.partial) return
    if (this.mode === 'text') emit.text(this.partial)
    else emit.reasoning(this.partial)
    this.partial = ''
  }

  reset(): void {
    this.mode = 'text'
    this.closeTag = THINK_CLOSE
    this.partial = ''
  }
}

function findEarliestTag(
  input: string,
  tags: readonly string[],
): { index: number; tag: string } | null {
  let best: { index: number; tag: string } | null = null
  for (const tag of tags) {
    const index = input.indexOf(tag)
    if (index === -1) continue
    if (!best || index < best.index || (index === best.index && tag.length > best.tag.length)) {
      best = { index, tag }
    }
  }
  return best
}

function findPartialTagSuffix(input: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, input.length); len > 0; len -= 1) {
    if (tag.startsWith(input.slice(-len))) {
      return input.length - len
    }
  }
  return -1
}

function findPartialTagSuffixAny(input: string, tags: readonly string[]): number {
  let best = -1
  for (const tag of tags) {
    const at = findPartialTagSuffix(input, tag)
    if (at >= 0 && (best < 0 || at < best)) best = at
  }
  return best
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return Object.keys(v as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = (v as Record<string, unknown>)[key]
          return acc
        }, {})
    }
    return v
  })
}

function toolCallKey(toolName: string, args: unknown): string {
  return `${toolName}:${stableJson(args)}`
}

export function truncateToolResultDefault(
  result: unknown,
  maxChars = DEFAULT_TOOL_RESULT_MAX_CHARS,
): unknown {
  if (typeof result === 'string') {
    if (result.length <= maxChars) return result
    return `${result.slice(0, maxChars)}\n… [truncated ${result.length - maxChars} chars]`
  }

  let serialized: string
  try {
    serialized = JSON.stringify(result)
  } catch {
    serialized = String(result)
  }

  if (serialized.length <= maxChars) return result

  return {
    truncated: true,
    originalLength: serialized.length,
    preview: `${serialized.slice(0, maxChars)}… [truncated]`,
  }
}

export async function processFullStream<TOOLS extends ToolSet = ToolSet>(
  fullStream: AsyncIterable<TextStreamPart<TOOLS>>,
  options: ProcessFullStreamOptions,
): Promise<ProcessFullStreamResult> {
  const truncate = options.truncateToolResult ?? truncateToolResultDefault
  const doomThreshold = options.doomLoop?.threshold ?? 3
  const createSegmentId = options.createSegmentId ?? (() => crypto.randomUUID())

  let finishReason: string | undefined
  let stopped = false
  let streamError: unknown
  const thinkParser = new ThinkTagParser()
  let activeContent:
    | {
        id: string
        type: 'text' | 'reasoning'
        content: string
        sourceId?: string
      }
    | undefined
  let activeStepId: string | undefined
  let thinkSourceId: string | undefined
  const toolSegments = new Map<string, string>()

  let lastToolKey: string | undefined
  let consecutiveToolCount = 0

  const closeContent = async () => {
    const segment = activeContent
    if (!segment) return
    activeContent = undefined
    options.onEvent({
      kind: 'segment-end',
      segmentId: segment.id,
      segmentType: segment.type,
    })
    if (segment.content) {
      await options.onPart?.({
        id: segment.id,
        type: segment.type,
        content: segment.content,
      })
    }
  }

  const startContent = async (type: 'text' | 'reasoning', sourceId?: string, force = false) => {
    if (
      !force &&
      activeContent?.type === type &&
      (!sourceId || activeContent.sourceId === sourceId)
    ) {
      return activeContent
    }
    await closeContent()
    const segment = {
      id: createSegmentId(type),
      type,
      content: '',
      sourceId,
    }
    activeContent = segment
    options.onEvent({
      kind: 'segment-start',
      segmentId: segment.id,
      segmentType: type,
    })
    return segment
  }

  const emitContent = async (type: 'text' | 'reasoning', text: string, sourceId?: string) => {
    if (!text) return
    const segment = await startContent(type, sourceId)
    segment.content += text
    options.onEvent({
      kind: type === 'text' ? 'text-delta' : 'reasoning-delta',
      segmentId: segment.id,
      text,
    })
  }

  const processTextChunk = async (chunk: string, sourceId: string) => {
    thinkSourceId = sourceId
    const parsed: Array<{ type: 'text' | 'reasoning'; text: string }> = []
    thinkParser.process(chunk, {
      text: (text) => parsed.push({ type: 'text', text }),
      reasoning: (text) => parsed.push({ type: 'reasoning', text }),
    })
    for (const item of parsed) {
      await emitContent(item.type, item.text, sourceId)
    }
  }

  const flushThinkParser = async (reset = false) => {
    const parsed: Array<{ type: 'text' | 'reasoning'; text: string }> = []
    thinkParser.flush({
      text: (text) => parsed.push({ type: 'text', text }),
      reasoning: (text) => parsed.push({ type: 'reasoning', text }),
    })
    for (const item of parsed) {
      await emitContent(item.type, item.text, thinkSourceId)
    }
    if (reset) {
      thinkParser.reset()
      thinkSourceId = undefined
    }
  }

  const startStep = async () => {
    await flushThinkParser(true)
    await closeContent()
    if (activeStepId) {
      options.onEvent({ kind: 'step-end', stepId: activeStepId })
    }
    activeStepId = createSegmentId('step')
    options.onEvent({ kind: 'step-start', stepId: activeStepId })
  }

  const endStep = async (reason?: string) => {
    await flushThinkParser(true)
    await closeContent()
    if (!activeStepId) {
      activeStepId = createSegmentId('step')
      options.onEvent({ kind: 'step-start', stepId: activeStepId })
    }
    options.onEvent({
      kind: 'step-end',
      stepId: activeStepId,
      finishReason: reason,
    })
    activeStepId = undefined
  }

  const checkDoomLoop = async (toolName: string, args: unknown): Promise<boolean> => {
    if (!options.doomLoop) return false

    const key = toolCallKey(toolName, args)
    if (key === lastToolKey) {
      consecutiveToolCount += 1
    } else {
      lastToolKey = key
      consecutiveToolCount = 1
    }

    if (consecutiveToolCount < doomThreshold) return false

    const decision = await options.doomLoop.onDetect({
      toolName,
      args,
      count: consecutiveToolCount,
    })

    // UI ask is emitted by PermissionEngine.onAsk inside onDetect — do not emit a
    // second orphan permission-ask with a different requestId here.

    if (decision === 'stop') {
      stopped = true
      return true
    }

    lastToolKey = undefined
    consecutiveToolCount = 0
    return false
  }

  try {
    for await (const part of fullStream) {
      if (options.abortSignal?.aborted || stopped) {
        stopped = true
        break
      }

      switch (part.type) {
        case 'text-start':
          await flushThinkParser(true)
          await closeContent()
          await startContent('text', part.id, true)
          break

        case 'text-delta':
          await processTextChunk(part.text, part.id)
          break

        case 'text-end':
          await flushThinkParser(true)
          await closeContent()
          break

        case 'reasoning-start':
          await closeContent()
          await startContent('reasoning', part.id, true)
          break

        case 'reasoning-delta':
          await emitContent('reasoning', part.text, part.id)
          break

        case 'reasoning-end':
          await closeContent()
          break

        case 'tool-call': {
          await flushThinkParser(true)
          await closeContent()

          const args = 'input' in part ? part.input : undefined
          if (await checkDoomLoop(part.toolName, args)) {
            break
          }

          const segmentId = createSegmentId('tool')
          toolSegments.set(part.toolCallId, segmentId)
          options.onEvent({
            kind: 'tool-call',
            segmentId,
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args,
          })
          await options.onPart?.({
            id: segmentId,
            type: 'tool-call',
            content: {
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args,
            },
          })
          break
        }

        case 'tool-result': {
          const result = truncate(part.output)
          const segmentId = toolSegments.get(part.toolCallId) ?? createSegmentId('tool')
          toolSegments.set(part.toolCallId, segmentId)
          options.onEvent({
            kind: 'tool-result',
            segmentId,
            toolCallId: part.toolCallId,
            result,
          })
          await options.onPart?.({
            type: 'tool-result',
            content: { toolCallId: part.toolCallId, segmentId, result },
          })
          break
        }

        case 'tool-error': {
          const message =
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === 'string'
                ? part.error
                : 'Tool execution failed'
          const result = { error: message }
          const segmentId = toolSegments.get(part.toolCallId) ?? createSegmentId('tool')
          toolSegments.set(part.toolCallId, segmentId)
          options.onEvent({
            kind: 'tool-result',
            segmentId,
            toolCallId: part.toolCallId,
            result,
          })
          await options.onPart?.({
            type: 'tool-result',
            content: { toolCallId: part.toolCallId, segmentId, result },
          })
          options.onEvent({ kind: 'error', message })
          break
        }

        case 'start-step':
          await startStep()
          break

        case 'finish-step':
          finishReason = part.finishReason
          await endStep(part.finishReason)
          break

        case 'finish':
          finishReason = part.finishReason
          await flushThinkParser(true)
          await closeContent()
          if (activeStepId) {
            options.onEvent({
              kind: 'step-end',
              stepId: activeStepId,
              finishReason: part.finishReason,
            })
            activeStepId = undefined
          }
          break

        case 'error': {
          const message =
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === 'string'
                ? part.error
                : String(part.error)
          streamError = part.error
          if (options.emitErrors !== false) options.onEvent({ kind: 'error', message })
          stopped = true
          break
        }

        case 'abort':
          stopped = true
          break

        default:
          break
      }

      if (stopped) break
    }
  } finally {
    await flushThinkParser(true)
    await closeContent()
    if (activeStepId) {
      options.onEvent({ kind: 'step-end', stepId: activeStepId })
      activeStepId = undefined
    }
  }

  return { finishReason, stopped, error: streamError }
}
