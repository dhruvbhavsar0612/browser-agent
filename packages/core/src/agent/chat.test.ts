import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '../config/schema.js'
import { parseModelRef, resolveModelRef, toModelMessages } from './chat.js'

describe('agent chat', () => {
  it('parses provider/model refs', () => {
    expect(parseModelRef('anthropic/claude-sonnet-4-5')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-5',
    })
    expect(parseModelRef('openrouter/openai/gpt-4o')).toEqual({
      providerID: 'openrouter',
      modelID: 'openai/gpt-4o',
    })
  })

  it('rejects invalid model refs', () => {
    expect(() => parseModelRef('no-slash')).toThrow(/Invalid model ref/)
    expect(() => parseModelRef('/missing-provider')).toThrow(/Invalid model ref/)
  })

  it('resolves global config.model', () => {
    const config = {
      ...DEFAULT_CONFIG,
      model: 'openai/gpt-4.1',
    }
    expect(resolveModelRef(config)).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4.1',
    })
  })

  it('prefers agent-specific model override', () => {
    const config = {
      ...DEFAULT_CONFIG,
      model: 'openai/gpt-4.1',
      agent: {
        ...DEFAULT_CONFIG.agent,
        browse: {
          ...DEFAULT_CONFIG.agent.browse,
          model: { providerID: 'anthropic', modelID: 'claude-sonnet-4-5' },
        },
      },
    }
    expect(resolveModelRef(config, 'browse')).toEqual({
      providerID: 'anthropic',
      modelID: 'claude-sonnet-4-5',
    })
  })

  it('prefers a session pin over agent and global models', () => {
    const config = {
      ...DEFAULT_CONFIG,
      model: 'openai/gpt-global',
      agent: {
        ...DEFAULT_CONFIG.agent,
        browse: {
          ...DEFAULT_CONFIG.agent.browse,
          model: { providerID: 'anthropic', modelID: 'claude-agent' },
        },
      },
    }
    expect(resolveModelRef(config, 'browse', 'openrouter/openai/gpt-session')).toEqual({
      providerID: 'openrouter',
      modelID: 'openai/gpt-session',
    })
  })

  it('returns undefined when no model configured', () => {
    expect(resolveModelRef(DEFAULT_CONFIG)).toBeUndefined()
  })

  it('maps chat messages to AI SDK model messages', () => {
    expect(
      toModelMessages([
        { role: 'user', content: 'Hi' },
        { role: 'assistant', content: 'Hello' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
    ])
  })
})
