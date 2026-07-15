import { describe, expect, it, vi } from 'vitest'
import { MODELS_CACHE_KEY, createMemoryStorage } from '../config/storage.js'
import { ModelsDevService, getBundledSnapshot } from './models-dev.js'

describe('models.dev', () => {
  it('does not fetch or expose models before provider discovery', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const svc = new ModelsDevService(createMemoryStorage(), fetchImpl)
    expect(await svc.getCachedProvider('openai')).toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('filters the live catalog and caches only the requested provider', async () => {
    const storage = createMemoryStorage()
    const catalog = getBundledSnapshot()
    const fetchImpl = vi.fn(async () => Response.json(catalog)) as unknown as typeof fetch

    const svc = new ModelsDevService(storage, fetchImpl)
    const first = await svc.discoverProvider('openai', { forceRefresh: true })
    expect(first.provider.id).toBe('openai')
    expect(first.provider.models.some((model) => model.id.startsWith('gpt-5'))).toBe(true)
    expect(await svc.getCachedProvider('anthropic')).toBeNull()
    const raw = await storage.getLocal<{ providers: Record<string, unknown> }>(MODELS_CACHE_KEY)
    expect(Object.keys(raw?.providers ?? {})).toEqual(['openai'])
    expect(JSON.stringify(raw)).not.toContain('"anthropic"')
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    const cached = await svc.discoverProvider('openai')
    expect(cached.source).toBe('cache')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('uses only the requested snapshot provider when offline', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as typeof fetch
    const svc = new ModelsDevService(createMemoryStorage(), fetchImpl)
    const result = await svc.discoverProvider('anthropic', { forceRefresh: true })
    expect(result.provider.id).toBe('anthropic')
    expect(result.provider.models.some((model) => model.vision)).toBe(true)
    expect(result.source).toBe('snapshot')
    expect(result.offline).toBe(true)
  })

  it('returns a previously discovered provider cache when refresh is offline', async () => {
    const storage = createMemoryStorage()
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(Response.json(getBundledSnapshot()))
      .mockRejectedValueOnce(new Error('offline')) as unknown as typeof fetch
    const svc = new ModelsDevService(storage, fetchImpl)
    await svc.discoverProvider('google', { forceRefresh: true })
    const result = await svc.discoverProvider('google', { forceRefresh: true })
    expect(result.provider.id).toBe('google')
    expect(result.source).toBe('cache')
    expect(result.offline).toBe(true)
    expect(result.error).toContain('offline')
  })
})
