import type { ProviderModelConfig, ReasoningEffort } from './schema.js'
import { resolveLanguageModelSdk } from '../provider/model-api.js'

/**
 * Per-provider token budgets for each effort level when mapping our
 * 4-tier scale onto Anthropic's extended-thinking budget.
 */
const ANTHROPIC_BUDGET_TOKENS: Record<Exclude<ReasoningEffort, 'none'>, number> = {
  low: 1_024,
  medium: 8_000,
  high: 16_000,
}

export type ResolveReasoningOptions = {
  modelID?: string
  baseURL?: string
  sessionID?: string
}

function mergeProviderOptions(
  ...parts: Array<Record<string, Record<string, unknown>> | undefined>
): Record<string, Record<string, unknown>> | undefined {
  const merged: Record<string, Record<string, unknown>> = {}
  for (const part of parts) {
    if (!part) continue
    for (const [key, value] of Object.entries(part)) {
      merged[key] = { ...merged[key], ...value }
    }
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

/**
 * Resolve providerOptions for the AI SDK streamText / generateText calls based
 * on the model's reasoning_effort setting and OpenCode-style request options
 * (prompt cache key, MiniMax adaptive thinking).
 */
export function resolveReasoningProviderOptions(
  providerID: string,
  modelConfig: ProviderModelConfig | undefined,
  opts?: ResolveReasoningOptions,
): Record<string, Record<string, unknown>> | undefined {
  const sdk = resolveLanguageModelSdk(providerID, opts?.modelID ?? '', opts?.baseURL)
  const effort = modelConfig?.reasoning_effort
  let reasoning: Record<string, Record<string, unknown>> | undefined

  if (effort) {
    if (sdk === 'openai' || providerID === 'openai') {
      reasoning =
        effort === 'none'
          ? { openai: { reasoningEffort: 'none' } }
          : { openai: { reasoningEffort: effort } }
    } else if (sdk === 'anthropic' || providerID === 'anthropic') {
      reasoning =
        effort === 'none'
          ? { anthropic: { thinking: { type: 'disabled' } } }
          : {
              anthropic: {
                thinking: {
                  type: 'enabled',
                  budgetTokens: ANTHROPIC_BUDGET_TOKENS[effort],
                },
              },
            }
    } else if (providerID === 'google' || sdk === 'google') {
      if (effort === 'none') {
        reasoning = { google: { thinkingConfig: { thinkingBudget: 0 } } }
      } else {
        const budgets: Record<Exclude<ReasoningEffort, 'none'>, number> = {
          low: 1_024,
          medium: 8_192,
          high: 24_576,
        }
        reasoning = { google: { thinkingConfig: { thinkingBudget: budgets[effort] } } }
      }
    }
  }

  const extras: Array<Record<string, Record<string, unknown>> | undefined> = []
  if (sdk === 'openai' && opts?.sessionID) {
    extras.push({ openai: { promptCacheKey: opts.sessionID } })
  }

  const modelID = opts?.modelID?.toLowerCase() ?? ''
  if (sdk === 'anthropic' && modelID.includes('minimax-m3') && !modelConfig?.reasoning_effort) {
    extras.push({ anthropic: { thinking: { type: 'adaptive' } } })
  }

  return mergeProviderOptions(reasoning, ...extras)
}
