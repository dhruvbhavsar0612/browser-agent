import { usesOpenCodeProtocol } from './identity.js'

/**
 * AI SDK package used to talk to a model.
 * Matches OpenCode's `model.api.npm` routing for Zen/Go endpoints:
 * https://opencode.ai/docs/go/#endpoints
 */
export type LanguageModelSdk =
  'anthropic' | 'openai' | 'openai-compatible' | 'google' | 'openrouter'

const OPENAI_RESPONSES_PREFIXES = ['grok-', 'gpt-', 'muse-spark']
const ANTHROPIC_MESSAGES_PREFIXES = ['minimax-', 'qwen']

/**
 * Pick the native API for an OpenCode Zen/Go model id.
 * Responses (`@ai-sdk/openai`), Messages (`@ai-sdk/anthropic`), or
 * Chat Completions (`@ai-sdk/openai-compatible`).
 */
export function resolveOpenCodeModelSdk(modelID: string): LanguageModelSdk {
  const id = modelID.trim().toLowerCase()
  if (OPENAI_RESPONSES_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return 'openai'
  }
  if (ANTHROPIC_MESSAGES_PREFIXES.some((prefix) => id.startsWith(prefix))) {
    return 'anthropic'
  }
  return 'openai-compatible'
}

export function resolveLanguageModelSdk(
  providerID: string,
  modelID: string,
  baseURL?: string,
): LanguageModelSdk {
  if (providerID === 'anthropic') return 'anthropic'
  if (providerID === 'openai') return 'openai'
  if (providerID === 'google') return 'google'
  if (providerID === 'openrouter') return 'openrouter'

  if (usesOpenCodeProtocol(providerID, baseURL)) {
    return resolveOpenCodeModelSdk(modelID)
  }

  return 'openai-compatible'
}
