import type { ProviderModelConfig, ReasoningEffort } from './schema.js'

/**
 * Per-provider token budgets for each effort level when mapping our
 * 4-tier scale onto Anthropic's extended-thinking budget.
 */
const ANTHROPIC_BUDGET_TOKENS: Record<Exclude<ReasoningEffort, 'none'>, number> = {
  low: 1_024,
  medium: 8_000,
  high: 16_000,
}

/**
 * Resolve providerOptions for the AI SDK streamText / generateText calls based
 * on the model's reasoning_effort setting.
 *
 * Returns undefined when no reasoning-specific options are needed.
 */
export function resolveReasoningProviderOptions(
  providerID: string,
  modelConfig: ProviderModelConfig | undefined,
): Record<string, Record<string, unknown>> | undefined {
  const effort = modelConfig?.reasoning_effort
  if (!effort) return undefined

  if (providerID === 'openai') {
    if (effort === 'none') {
      // Explicitly disable reasoning for models that enable it by default.
      return { openai: { reasoningEffort: 'none' } }
    }
    return { openai: { reasoningEffort: effort } }
  }

  if (providerID === 'anthropic') {
    if (effort === 'none') {
      return { anthropic: { thinking: { type: 'disabled' } } }
    }
    return {
      anthropic: {
        thinking: {
          type: 'enabled',
          budgetTokens: ANTHROPIC_BUDGET_TOKENS[effort],
        },
      },
    }
  }

  // Google Gemini thinking mode
  if (providerID === 'google') {
    if (effort === 'none') {
      return { google: { thinkingConfig: { thinkingBudget: 0 } } }
    }
    const budgets: Record<Exclude<ReasoningEffort, 'none'>, number> = {
      low: 1_024,
      medium: 8_192,
      high: 24_576,
    }
    return { google: { thinkingConfig: { thinkingBudget: budgets[effort] } } }
  }

  // Unknown provider — silently ignore rather than break the call.
  return undefined
}
