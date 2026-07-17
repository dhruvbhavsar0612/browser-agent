import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig } from './schema.js'
import {
  listEnabledModelGroups,
  providerInfoFromEnabledConfig,
} from './enabled-models.js'

describe('listEnabledModelGroups', () => {
  it('surfaces config-enabled openai-compatible models without requiring discovery overlap', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        'openai-compatible': {
          enabled: true,
          api: 'https://opencode.ai/zen/go/v1',
          name: 'OpenAI-compatible',
          models: {
            'minimax-m2.5': { enabled: true, name: 'minimax-m2.5' },
            'qwen3.5-plus': { enabled: true, name: 'qwen3.5-plus' },
            'disabled-model': { enabled: false, name: 'nope' },
          },
        },
      },
    })

    // Discovery cache empty — previously caused "No enabled models" in Chat.
    const groups = listEnabledModelGroups(config, [])
    expect(groups).toHaveLength(1)
    expect(groups[0]?.provider.id).toBe('openai-compatible')
    expect(groups[0]?.models.map((model) => model.id)).toEqual([
      'minimax-m2.5',
      'qwen3.5-plus',
    ])
  })

  it('prefers discovered display metadata when available', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
    const groups = listEnabledModelGroups(
      config,
      [
        {
          id: 'openai',
          name: 'OpenAI',
          models: [
            {
              id: 'gpt-4.1',
              name: 'GPT-4.1',
              providerID: 'openai',
              toolCall: true,
              vision: true,
              context: 128_000,
            },
          ],
        },
      ],
      { connections: { openai: { hasCredential: true, hasEndpoint: false } } },
    )
    expect(groups[0]?.models[0]).toMatchObject({
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      toolCall: true,
      vision: true,
    })
  })

  it('hides catalog providers that are not connected', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
    expect(listEnabledModelGroups(config, [], { connections: {} })).toEqual([])
  })
})

describe('providerInfoFromEnabledConfig', () => {
  it('builds a synthetic provider from enabled model config', () => {
    const config = mergeConfig(DEFAULT_CONFIG, {
      provider: {
        'openai-compatible': {
          enabled: true,
          api: 'https://opencode.ai/zen/go/v1',
          models: { 'minimax-m3': { enabled: true, name: 'minimax-m3' } },
        },
      },
    })
    expect(providerInfoFromEnabledConfig('openai-compatible', config)).toMatchObject({
      id: 'openai-compatible',
      models: [{ id: 'minimax-m3' }],
    })
  })
})
