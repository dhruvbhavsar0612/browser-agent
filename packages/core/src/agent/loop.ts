import {
  streamText,
  stepCountIs,
  type LanguageModel,
  type ModelMessage,
  type StopCondition,
  type ToolSet,
} from 'ai'
import type { StreamEvent } from '../messaging/index.js'
import type { SessionStore } from '../session/index.js'
import { processFullStream, type DoomLoopOptions } from './processor.js'

function messageText(content: ModelMessage['content']): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export type AgentLoopSession = {
  store: SessionStore
  sessionId: string
}

export type AgentLoopOptions = {
  model: LanguageModel
  messages: ModelMessage[]
  system?: string
  tools?: ToolSet
  steps?: number
  stopWhen?: StopCondition<ToolSet>
  abortSignal?: AbortSignal
  onEvent: (event: StreamEvent) => void
  doomLoop?: DoomLoopOptions
  session?: AgentLoopSession
  /** Provider-specific options forwarded to streamText (e.g. reasoning effort). */
  providerOptions?: Parameters<typeof streamText>[0]['providerOptions']
  onContextOverflow?: (
    error: unknown,
  ) => Promise<{ messages: ModelMessage[]; system?: string } | null>
}

export type AgentLoopResult = {
  finishReason?: string
  stopped: boolean
}

const CONTEXT_OVERFLOW_PATTERN =
  /(?:context(?: length| window)?|maximum context|prompt|input).{0,80}(?:exceed|too (?:large|long)|limit|maximum)|too many tokens|token limit|request too large|context_length_exceeded|max_tokens/i

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function isContextOverflowError(error: unknown): boolean {
  if (CONTEXT_OVERFLOW_PATTERN.test(errorMessage(error))) return true
  if (!error || typeof error !== 'object') return false
  const value = error as { code?: unknown; type?: unknown; cause?: unknown; responseBody?: unknown }
  return (
    value.code === 'context_length_exceeded' ||
    value.type === 'context_length_exceeded' ||
    (value.cause !== undefined && isContextOverflowError(value.cause)) ||
    (value.responseBody !== undefined && isContextOverflowError(value.responseBody))
  )
}

export async function runAgentLoop(options: AgentLoopOptions): Promise<AgentLoopResult> {
  const steps = options.steps ?? 5
  const stopWhen = options.stopWhen ?? stepCountIs(steps)

  let assistantMessageId: string | undefined

  if (options.session) {
    const lastUserIndex = options.messages
      .map((message, index) => (message.role === 'user' ? index : -1))
      .filter((index) => index >= 0)
      .at(-1)

    if (lastUserIndex !== undefined) {
      const text = messageText(options.messages[lastUserIndex]!.content)
      if (text) {
        const userRecord = await options.session.store.appendMessage({
          sessionId: options.session.sessionId,
          role: 'user',
        })
        await options.session.store.appendPart({
          messageId: userRecord.id,
          type: 'text',
          content: text,
        })
      }
    }

    const assistantRecord = await options.session.store.appendMessage({
      sessionId: options.session.sessionId,
      role: 'assistant',
    })
    assistantMessageId = assistantRecord.id
  }

  let assistantPartOrder = 0
  const persistPart =
    options.session && assistantMessageId
      ? async (
          part: Parameters<NonNullable<Parameters<typeof processFullStream>[1]['onPart']>>[0],
        ) => {
          await options.session!.store.appendPart({
            id: 'id' in part ? part.id : undefined,
            messageId: assistantMessageId!,
            type: part.type,
            content: part.content,
            order: assistantPartOrder,
          })
          assistantPartOrder += 1
        }
      : undefined

  const execute = async (
    messages: ModelMessage[],
    system: string | undefined,
    canRetry: boolean,
  ): Promise<Awaited<ReturnType<typeof processFullStream>>> => {
    let emittedStreamEvent = false
    const onEvent = (event: StreamEvent) => {
      if (event.kind !== 'error') emittedStreamEvent = true
      options.onEvent(event)
    }

    let streamResult: Awaited<ReturnType<typeof processFullStream>>
    try {
      const result = streamText({
        model: options.model,
        messages,
        system,
        tools: options.tools,
        stopWhen,
        abortSignal: options.abortSignal,
        providerOptions: options.providerOptions,
      })
      streamResult = await processFullStream(result.fullStream, {
        onEvent,
        onPart: persistPart,
        doomLoop: options.doomLoop,
        abortSignal: options.abortSignal,
        emitErrors: false,
      })
    } catch (error) {
      streamResult = { stopped: true, error }
    }

    if (
      canRetry &&
      streamResult.error &&
      !emittedStreamEvent &&
      !options.abortSignal?.aborted &&
      isContextOverflowError(streamResult.error)
    ) {
      const retryPrompt = await options.onContextOverflow?.(streamResult.error)
      if (retryPrompt) return execute(retryPrompt.messages, retryPrompt.system ?? system, false)
    }

    if (streamResult.error) {
      options.onEvent({ kind: 'error', message: errorMessage(streamResult.error) })
    }
    return streamResult
  }

  const streamResult = await execute(
    options.messages,
    options.system,
    Boolean(options.onContextOverflow),
  )

  if (!options.abortSignal?.aborted && !streamResult.stopped) {
    options.onEvent({ kind: 'done' })
  }

  return streamResult
}
