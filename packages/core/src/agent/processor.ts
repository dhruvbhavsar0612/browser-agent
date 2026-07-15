import type { TextStreamPart, ToolSet } from 'ai'
import type { StreamEvent } from '../messaging/index.js'

export const DEFAULT_TOOL_RESULT_MAX_CHARS = 32_000

const THINK_TAG = 'redacted' + '_' + 'thinking'
export const THINK_OPEN = '<' + THINK_TAG + '>'
export const THINK_CLOSE = '</' + THINK_TAG + '>'

export type DurablePart =
  | { type: 'text'; content: string }
  | { type: 'reasoning'; content: string }
  | {
      type: 'tool-call'
      content: { toolCallId: string; toolName: string; args: unknown }
    }
  | { type: 'tool-result'; content: { toolCallId: string; result: unknown } }

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
  onPart?: (part: DurablePart) => void
  truncateToolResult?: (result: unknown) => unknown
  doomLoop?: DoomLoopOptions
  abortSignal?: AbortSignal
}

export type ProcessFullStreamResult = {
  finishReason?: string
  stopped: boolean
}

type ThinkEmit = {
  text: (chunk: string) => void
  reasoning: (chunk: string) => void
}

/** Strips `<think>…</think>` from text deltas into reasoning. */
export class ThinkTagParser {
  private mode: 'text' | 'thinking' = 'text'
  private partial = ''

  process(chunk: string, emit: ThinkEmit): void {
    let input = this.partial + chunk
    this.partial = ''

    while (input.length > 0) {
      if (this.mode === 'text') {
        const idx = input.indexOf(THINK_OPEN)
        if (idx === -1) {
          const partialAt = findPartialTagSuffix(input, THINK_OPEN)
          if (partialAt >= 0) {
            const text = input.slice(0, partialAt)
            if (text) emit.text(text)
            this.partial = input.slice(partialAt)
            return
          }
          emit.text(input)
          return
        }
        const before = input.slice(0, idx)
        if (before) emit.text(before)
        input = input.slice(idx + THINK_OPEN.length)
        this.mode = 'thinking'
        continue
      }

      const idx = input.indexOf(THINK_CLOSE)
      if (idx === -1) {
        const partialAt = findPartialTagSuffix(input, THINK_CLOSE)
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
      input = input.slice(idx + THINK_CLOSE.length)
      this.mode = 'text'
    }
  }

  flush(emit: ThinkEmit): void {
    if (!this.partial) return
    if (this.mode === 'text') emit.text(this.partial)
    else emit.reasoning(this.partial)
    this.partial = ''
  }
}

function findPartialTagSuffix(input: string, tag: string): number {
  for (let len = Math.min(tag.length - 1, input.length); len > 0; len -= 1) {
    if (tag.startsWith(input.slice(-len))) {
      return input.length - len
    }
  }
  return -1
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

  let finishReason: string | undefined
  let stopped = false
  let textBuffer = ''
  let reasoningBuffer = ''
  const thinkParser = new ThinkTagParser()

  let lastToolKey: string | undefined
  let consecutiveToolCount = 0

  const emitTextDelta = (text: string) => {
    if (!text) return
    options.onEvent({ kind: 'text-delta', text })
    textBuffer += text
  }

  const emitReasoningDelta = (text: string) => {
    if (!text) return
    options.onEvent({ kind: 'reasoning-delta', text })
    reasoningBuffer += text
  }

  const flushText = () => {
    if (!textBuffer) return
    options.onPart?.({ type: 'text', content: textBuffer })
    textBuffer = ''
  }

  const flushReasoning = () => {
    if (!reasoningBuffer) return
    options.onPart?.({ type: 'reasoning', content: reasoningBuffer })
    reasoningBuffer = ''
  }

  const processTextChunk = (chunk: string) => {
    thinkParser.process(chunk, {
      text: emitTextDelta,
      reasoning: emitReasoningDelta,
    })
  }

  const flushThinkParser = () => {
    thinkParser.flush({
      text: emitTextDelta,
      reasoning: emitReasoningDelta,
    })
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

    options.onEvent({
      kind: 'permission-ask',
      requestId: crypto.randomUUID(),
      permission: 'doom_loop',
      patterns: [toolName],
      metadata: { toolName, args, count: consecutiveToolCount },
    })

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
          break

        case 'text-delta':
          processTextChunk(part.text)
          break

        case 'text-end':
          flushThinkParser()
          flushText()
          break

        case 'reasoning-start':
          break

        case 'reasoning-delta':
          emitReasoningDelta(part.text)
          break

        case 'reasoning-end':
          flushReasoning()
          break

        case 'tool-call': {
          flushThinkParser()
          flushText()
          flushReasoning()

          const args = 'input' in part ? part.input : undefined
          if (await checkDoomLoop(part.toolName, args)) {
            break
          }

          options.onEvent({
            kind: 'tool-call',
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            args,
          })
          options.onPart?.({
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
          options.onEvent({
            kind: 'tool-result',
            toolCallId: part.toolCallId,
            result,
          })
          options.onPart?.({
            type: 'tool-result',
            content: { toolCallId: part.toolCallId, result },
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
          options.onEvent({ kind: 'error', message })
          break
        }

        case 'finish-step':
          finishReason = part.finishReason
          break

        case 'finish':
          finishReason = part.finishReason
          break

        case 'error': {
          const message =
            part.error instanceof Error
              ? part.error.message
              : typeof part.error === 'string'
                ? part.error
                : String(part.error)
          options.onEvent({ kind: 'error', message })
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
    flushThinkParser()
    flushText()
    flushReasoning()
  }

  return { finishReason, stopped }
}
