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
        openai: { npm: '@ai-sdk/openai', name: 'OpenAI' },
      },
    })
    expect(merged.provider.openai?.name).toBe('OpenAI')
  })
})
