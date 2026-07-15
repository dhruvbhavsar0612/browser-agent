import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig, parseConfig } from './schema.js'

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
})
