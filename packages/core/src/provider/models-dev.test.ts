import { describe, expect, it, vi } from 'vitest'
import { createMemoryStorage } from '../config/storage.js'
import { ModelsDevService, getBundledSnapshot } from './models-dev.js'

describe('models.dev', () => {
  it('ships offline snapshot with tool_call and vision flags', async () => {
    const svc = new ModelsDevService(createMemoryStorage(), vi.fn() as unknown as typeof fetch)
    const providers = await svc.listProviders()
    expect(providers.length).toBeGreaterThan(0)
    const anthropic = providers.find((p) => p.id === 'anthropic')
    expect(anthropic?.models[0]?.toolCall).toBe(true)
    expect(anthropic?.models[0]?.vision).toBe(true)
  })

  it('caches network catalog and respects TTL', async () => {
    const storage = createMemoryStorage()
    const catalog = getBundledSnapshot()
    const fetchImpl = vi.fn(async () =>
      Response.json({
        ...catalog,
        custom: {
          name: 'Custom',
          models: {
            'x-1': {
              id: 'x-1',
              name: 'X1',
              tool_call: true,
              modalities: { input: ['text'] },
              limit: { context: 8_000 },
            },
          },
        },
      }),
    ) as unknown as typeof fetch

    const svc = new ModelsDevService(storage, fetchImpl)
    const first = await svc.listProviders({ forceRefresh: true })
    expect(first.some((p) => p.id === 'custom')).toBe(true)
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await svc.listProviders()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('falls back to snapshot when fetch fails and cache empty', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const svc = new ModelsDevService(createMemoryStorage(), fetchImpl)
    const providers = await svc.listProviders({ forceRefresh: true })
    expect(providers.find((p) => p.id === 'openai')).toBeDefined()
  })
})
