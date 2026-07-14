import { describe, expect, it, vi } from 'vitest'
import {
  fetchOpenAICompatibleModels,
  mergeCompatibleProvider,
  modelsEndpointUrl,
  toOpenAICompatibleProvider,
} from './openai-compatible-models.js'
import type { ProviderInfo } from './index.js'

describe('modelsEndpointUrl', () => {
  it('joins baseURL with /models', () => {
    expect(modelsEndpointUrl('https://opencode.ai/zen/go/v1')).toBe(
      'https://opencode.ai/zen/go/v1/models',
    )
    expect(modelsEndpointUrl('https://opencode.ai/zen/go/v1/')).toBe(
      'https://opencode.ai/zen/go/v1/models',
    )
  })

  it('rejects empty baseURL', () => {
    expect(() => modelsEndpointUrl('')).toThrow(/baseURL/)
    expect(() => modelsEndpointUrl('   ')).toThrow(/baseURL/)
  })
})

describe('toOpenAICompatibleProvider', () => {
  it('maps OpenAI model list entries', () => {
    const provider = toOpenAICompatibleProvider([
      { id: 'minimax-m3', owned_by: 'opencode' },
      { id: 'glm-5' },
    ])
    expect(provider.id).toBe('openai-compatible')
    expect(provider.models.map((m) => m.id)).toEqual(['glm-5', 'minimax-m3'])
  })
})

describe('fetchOpenAICompatibleModels', () => {
  it('fetches and parses OpenAI-style /models', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        object: 'list',
        data: [
          { id: 'minimax-m3', object: 'model', owned_by: 'opencode' },
          { id: 'kimi-k2.5', object: 'model', owned_by: 'opencode' },
        ],
      }),
    )

    const provider = await fetchOpenAICompatibleModels({
      baseURL: 'https://opencode.ai/zen/go/v1',
      apiKey: 'sk-test',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
          Accept: 'application/json',
        }),
      }),
    )
    expect(provider.models.map((m) => m.id).sort()).toEqual(['kimi-k2.5', 'minimax-m3'])
  })

  it('throws on HTTP errors', async () => {
    await expect(
      fetchOpenAICompatibleModels({
        baseURL: 'https://example.com/v1',
        fetchImpl: (async () => new Response('nope', { status: 401 })) as typeof fetch,
      }),
    ).rejects.toThrow(/HTTP 401/)
  })
})

describe('mergeCompatibleProvider', () => {
  const catalog: ProviderInfo[] = [
    { id: 'openai', name: 'OpenAI', models: [{ id: 'gpt-4.1', name: 'GPT-4.1', providerID: 'openai', toolCall: true, vision: true, context: 0 }] },
  ]

  it('prepends remote openai-compatible models', () => {
    const remote = toOpenAICompatibleProvider([{ id: 'minimax-m3' }])
    const merged = mergeCompatibleProvider(catalog, remote)
    expect(merged[0]?.id).toBe('openai-compatible')
    expect(merged[0]?.models[0]?.id).toBe('minimax-m3')
    expect(merged.some((p) => p.id === 'openai')).toBe(true)
  })

  it('leaves catalog alone when remote is null', () => {
    expect(mergeCompatibleProvider(catalog, null)).toEqual(catalog)
  })
})
