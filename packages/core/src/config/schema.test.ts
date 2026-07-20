import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig, parseConfig } from './schema.js'
import { resolveReasoningProviderOptions } from './reasoning.js'

describe('config schema', () => {
  it('parses default config', () => {
    const cfg = parseConfig(DEFAULT_CONFIG)
    expect(cfg.executionMode).toBe('approval')
    expect(cfg.agent.browse).toBeDefined()
  })

  it('rejects invalid execution mode', () => {
    expect(() => parseConfig({ ...DEFAULT_CONFIG, executionMode: 'nope' })).toThrow()
  })

  it('merges provider overrides', () => {
    const merged = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        openai: {
          enabled: true,
          npm: '@ai-sdk/openai',
          name: 'OpenAI',
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
    expect(merged.provider.openai?.name).toBe('OpenAI')
    const patched = mergeConfig(merged, {
      provider: {
        openai: { models: { 'gpt-4.1-mini': { enabled: false } } },
      },
    })
    expect(patched.provider.openai?.enabled).toBe(true)
    expect(patched.provider.openai?.name).toBe('OpenAI')
    expect(patched.provider.openai?.models['gpt-4.1']?.enabled).toBe(true)
    expect(patched.provider.openai?.models['gpt-4.1-mini']?.enabled).toBe(false)
  })

  it('requires the global default model to be enabled', () => {
    expect(() => mergeConfig(DEFAULT_CONFIG, { model: 'openai/gpt-4.1' })).toThrow(
      /Default model must belong/,
    )

    const config = mergeConfig(DEFAULT_CONFIG, {
      model: 'openai/gpt-4.1',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
    expect(config.model).toBe('openai/gpt-4.1')

    expect(() =>
      mergeConfig(config, {
        provider: {
          openai: { models: { 'gpt-4.1': { enabled: false } } },
        },
      }),
    ).toThrow(/Default model must belong/)
  })

  it('validates and deeply merges remote MCP servers', () => {
    const configured = mergeConfig(DEFAULT_CONFIG, {
      mcp: {
        docs: {
          name: 'Docs',
          url: 'https://mcp.example.com/api',
          transport: 'auto',
          auth: { mode: 'oauth' },
          tools: { search: { enabled: true } },
        },
      },
    })
    const patched = mergeConfig(configured, {
      mcp: { docs: { enabled: false, tools: { search: { enabled: false } } } },
    })
    expect(patched.mcp.docs).toMatchObject({
      name: 'Docs',
      url: 'https://mcp.example.com/api',
      enabled: false,
      tools: { search: { enabled: false } },
    })
    expect(mergeConfig(patched, { mcp: { docs: null } }).mcp.docs).toBeUndefined()
  })

  it('requires HTTPS except for localhost and rejects secret synced headers', () => {
    expect(() =>
      mergeConfig(DEFAULT_CONFIG, {
        mcp: { bad: { url: 'http://mcp.example.com' } },
      }),
    ).toThrow(/HTTPS/)
    expect(
      mergeConfig(DEFAULT_CONFIG, {
        mcp: { local: { url: 'http://localhost:8787/mcp' } },
      }).mcp.local?.url,
    ).toBe('http://localhost:8787/mcp')
    expect(() =>
      mergeConfig(DEFAULT_CONFIG, {
        mcp: {
          bad: {
            url: 'https://mcp.example.com',
            headers: { Authorization: 'Bearer secret' },
          },
        },
      }),
    ).toThrow(/credential vault/)
  })
})

describe('reasoning_effort schema', () => {
  it('parses valid reasoning_effort values on ProviderModelConfig', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        openai: {
          enabled: true,
          models: {
            'o3-mini': { enabled: true, reasoning_effort: 'medium' },
            'gpt-4.1': { enabled: true },
          },
        },
      },
    })
    expect(config.provider.openai?.models['o3-mini']?.reasoning_effort).toBe('medium')
    expect(config.provider.openai?.models['gpt-4.1']?.reasoning_effort).toBeUndefined()
  })

  it('accepts all four reasoning_effort levels', () => {
    for (const level of ['none', 'low', 'medium', 'high'] as const) {
      const config = mergeConfig(DEFAULT_CONFIG, {
        provider: {
          openai: {
            enabled: true,
            models: { 'o3-mini': { enabled: true, reasoning_effort: level } },
          },
        },
      })
      expect(config.provider.openai?.models['o3-mini']?.reasoning_effort).toBe(level)
    }
  })

  it('rejects unknown reasoning_effort values', () => {
    expect(() =>
      mergeConfig(DEFAULT_CONFIG, {
        provider: {
          openai: {
            enabled: true,
            models: { 'o3-mini': { enabled: true, reasoning_effort: 'ultra' as never } },
          },
        },
      }),
    ).toThrow()
  })

  it('reasoning_effort is preserved through a second merge pass', () => {
    const first = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        anthropic: {
          enabled: true,
          models: { 'claude-3-7-sonnet': { enabled: true, reasoning_effort: 'high' } },
        },
      },
    })
    const second = mergeConfig(first, {
      provider: { anthropic: { models: { 'claude-3-7-sonnet': { enabled: true } } } },
    })
    expect(second.provider.anthropic?.models['claude-3-7-sonnet']?.reasoning_effort).toBe('high')
  })

  it('disabling the default model still validates (regression)', () => {
    const withModel = mergeConfig(DEFAULT_CONFIG, {
      model: 'openai/gpt-4.1',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true, reasoning_effort: 'low' } },
        },
      },
    })
    expect(withModel.model).toBe('openai/gpt-4.1')

    expect(() =>
      mergeConfig(withModel, {
        provider: {
          openai: { models: { 'gpt-4.1': { enabled: false } } },
        },
      }),
    ).toThrow(/Default model must belong/)
  })
})

describe('resolveReasoningProviderOptions', () => {
  it('returns undefined when model config has no reasoning_effort', () => {
    expect(
      resolveReasoningProviderOptions('openai', { enabled: true }),
    ).toBeUndefined()
    expect(resolveReasoningProviderOptions('openai', undefined)).toBeUndefined()
  })

  it('maps OpenAI reasoning_effort to openai providerOptions', () => {
    expect(resolveReasoningProviderOptions('openai', { enabled: true, reasoning_effort: 'low' }))
      .toEqual({ openai: { reasoningEffort: 'low' } })
    expect(resolveReasoningProviderOptions('openai', { enabled: true, reasoning_effort: 'medium' }))
      .toEqual({ openai: { reasoningEffort: 'medium' } })
    expect(resolveReasoningProviderOptions('openai', { enabled: true, reasoning_effort: 'high' }))
      .toEqual({ openai: { reasoningEffort: 'high' } })
    expect(resolveReasoningProviderOptions('openai', { enabled: true, reasoning_effort: 'none' }))
      .toEqual({ openai: { reasoningEffort: 'none' } })
  })

  it('maps Anthropic reasoning_effort to thinking providerOptions', () => {
    const low = resolveReasoningProviderOptions('anthropic', { enabled: true, reasoning_effort: 'low' })
    expect(low).toMatchObject({ anthropic: { thinking: { type: 'enabled', budgetTokens: 1024 } } })

    const high = resolveReasoningProviderOptions('anthropic', { enabled: true, reasoning_effort: 'high' })
    expect(high).toMatchObject({ anthropic: { thinking: { type: 'enabled', budgetTokens: 16000 } } })

    const none = resolveReasoningProviderOptions('anthropic', { enabled: true, reasoning_effort: 'none' })
    expect(none).toMatchObject({ anthropic: { thinking: { type: 'disabled' } } })
  })

  it('maps Google reasoning_effort to thinkingConfig providerOptions', () => {
    const medium = resolveReasoningProviderOptions('google', { enabled: true, reasoning_effort: 'medium' })
    expect(medium).toMatchObject({ google: { thinkingConfig: { thinkingBudget: 8192 } } })

    const none = resolveReasoningProviderOptions('google', { enabled: true, reasoning_effort: 'none' })
    expect(none).toMatchObject({ google: { thinkingConfig: { thinkingBudget: 0 } } })
  })

  it('returns undefined for unknown provider with reasoning_effort', () => {
    expect(
      resolveReasoningProviderOptions('openai-compatible', { enabled: true, reasoning_effort: 'medium' }),
    ).toBeUndefined()
  })
})
