import type { TextStreamPart, ToolSet } from 'ai'
import type { StreamEvent } from '../messaging/index.js'

export const DEFAULT_TOOL_RESULT_MAX_CHARS = 32_000

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

  let lastToolKey: string | undefined
  let consecutiveToolCount = 0

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

        case 'text-delta': {
          textBuffer += part.text
          options.onEvent({ kind: 'text-delta', text: part.text })
          break
        }

        case 'text-end':
          flushText()
          break

        case 'reasoning-start':
          break

        case 'reasoning-delta': {
          reasoningBuffer += part.text
          options.onEvent({ kind: 'text-delta', text: part.text })
          break
        }

        case 'reasoning-end':
          flushReasoning()
          break

        case 'tool-call': {
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
    flushText()
    flushReasoning()
  }

  return { finishReason, stopped }
}
