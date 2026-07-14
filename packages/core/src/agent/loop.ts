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
}

export type AgentLoopResult = {
  finishReason?: string
  stopped: boolean
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

  const result = streamText({
    model: options.model,
    messages: options.messages,
    system: options.system,
    tools: options.tools,
    stopWhen,
    abortSignal: options.abortSignal,
  })

  const streamResult = await processFullStream(result.fullStream, {
    onEvent: options.onEvent,
    onPart:
      options.session && assistantMessageId
        ? (part) =>
            options.session!.store.appendPart({
              messageId: assistantMessageId!,
              type: part.type,
              content: part.content,
            })
        : undefined,
    doomLoop: options.doomLoop,
    abortSignal: options.abortSignal,
  })

  if (!options.abortSignal?.aborted && !streamResult.stopped) {
    options.onEvent({ kind: 'done' })
  }

  return streamResult
}
