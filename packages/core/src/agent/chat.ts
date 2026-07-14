import { streamText, type ModelMessage } from 'ai'
import type { AppConfig } from '../config/schema.js'
import {
  getModel,
  type GetModelOptions,
} from '../provider/factory.js'

export type ChatRole = 'user' | 'assistant'

export type ChatMessage = {
  role: ChatRole
  content: string
}

export type ModelRef = {
  providerID: string
  modelID: string
}

export function parseModelRef(ref: string): ModelRef {
  const slash = ref.indexOf('/')
  if (slash <= 0 || slash === ref.length - 1) {
    throw new Error(`Invalid model ref "${ref}". Expected "providerID/modelID".`)
  }
  return {
    providerID: ref.slice(0, slash),
    modelID: ref.slice(slash + 1),
  }
}

/** Resolve provider + model from agent override or global config.model. */
export function resolveModelRef(config: AppConfig, agentName = 'browse'): ModelRef | undefined {
  const agentModel = config.agent[agentName]?.model
  if (agentModel) {
    return { providerID: agentModel.providerID, modelID: agentModel.modelID }
  }
  if (config.model) {
    return parseModelRef(config.model)
  }
  return undefined
}

export function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content,
  }))
}

export type StreamChatOptions = {
  modelRef: ModelRef
  messages: ChatMessage[]
  apiKey?: string
  getModelOptions?: GetModelOptions
  abortSignal?: AbortSignal
  system?: string
}

/** Yield incremental assistant text from streamText. */
export async function* streamChatText(
  options: StreamChatOptions,
): AsyncGenerator<string, void, undefined> {
  const { providerID, modelID } = options.modelRef
  const model = await getModel(providerID, modelID, {
    ...options.getModelOptions,
    apiKey: options.apiKey ?? options.getModelOptions?.apiKey,
  })

  const result = streamText({
    model,
    messages: toModelMessages(options.messages),
    system: options.system,
    abortSignal: options.abortSignal,
  })

  for await (const chunk of result.textStream) {
    if (chunk) {
      yield chunk
    }
  }
}
