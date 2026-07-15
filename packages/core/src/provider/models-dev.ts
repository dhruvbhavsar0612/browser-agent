import { z } from 'zod'
import type { StorageAdapter } from '../config/storage.js'
import { MODELS_CACHE_KEY } from '../config/storage.js'
import type { ModelInfo, ProviderInfo } from './index.js'
import snapshot from './models-dev.snapshot.json'

const ModelSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    tool_call: z.boolean().optional(),
    modalities: z
      .object({
        input: z.array(z.string()).optional(),
      })
      .optional(),
    limit: z
      .object({
        context: z.number().optional(),
      })
      .optional(),
  })
  .passthrough()

const ProviderSchema = z
  .object({
    id: z.string().optional(),
    name: z.string(),
    models: z.record(z.string(), ModelSchema).optional(),
  })
  .passthrough()

const CatalogSchema = z.record(z.string(), ProviderSchema)

export type ModelsCatalog = z.infer<typeof CatalogSchema>

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const MODELS_CACHE_TTL_MS = 5 * 60 * 1000

export type ModelDiscoverySource = 'network' | 'cache' | 'snapshot'

export interface ProviderModelsCacheEntry {
  fetchedAt: number
  provider: ProviderInfo
  source: Exclude<ModelDiscoverySource, 'cache'>
}

export interface ModelsCacheEntry {
  providers: Record<string, ProviderModelsCacheEntry>
}

export interface ProviderDiscoveryResult {
  provider: ProviderInfo
  fetchedAt: number
  source: ModelDiscoverySource
  offline: boolean
  error?: string
}

function toProviderInfo(providerID: string, raw: z.infer<typeof ProviderSchema>): ProviderInfo {
  const models: ModelInfo[] = Object.entries(raw.models ?? {}).map(([id, model]) => ({
    id,
    name: model.name,
    providerID,
    toolCall: model.tool_call ?? false,
    vision: model.modalities?.input?.includes('image') ?? false,
    context: model.limit?.context ?? 0,
  }))
  return {
    id: providerID,
    name: raw.name,
    models,
  }
}

export function catalogToProviders(catalog: ModelsCatalog): ProviderInfo[] {
  return Object.entries(catalog).map(([id, provider]) => toProviderInfo(id, provider))
}

export function getBundledSnapshot(): ModelsCatalog {
  return CatalogSchema.parse(snapshot)
}

export class ModelsDevService {
  constructor(
    private readonly storage: StorageAdapter,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  /**
   * Discover one connected provider. The full models.dev response is never
   * persisted or returned; only the requested provider is cached locally.
   */
  async discoverProvider(
    providerID: string,
    opts?: { forceRefresh?: boolean },
  ): Promise<ProviderDiscoveryResult> {
    const cached = await this.getCacheEntry(providerID)
    if (cached && !opts?.forceRefresh && Date.now() - cached.fetchedAt < MODELS_CACHE_TTL_MS) {
      return {
        provider: cached.provider,
        fetchedAt: cached.fetchedAt,
        source: 'cache',
        offline: false,
      }
    }

    try {
      const res = await this.fetchImpl(MODELS_DEV_URL)
      if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`)
      const catalog = CatalogSchema.parse(await res.json())
      const rawProvider = catalog[providerID]
      if (!rawProvider) {
        throw new Error(`models.dev has no provider named "${providerID}"`)
      }
      const provider = toProviderInfo(providerID, rawProvider)
      const fetchedAt = Date.now()
      await this.cacheProvider(provider, { fetchedAt, source: 'network' })
      return { provider, fetchedAt, source: 'network', offline: false }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      if (cached) {
        return {
          provider: cached.provider,
          fetchedAt: cached.fetchedAt,
          source: 'cache',
          offline: true,
          error,
        }
      }

      const bundled = getBundledSnapshot()[providerID]
      if (!bundled) throw new Error(error)
      const provider = toProviderInfo(providerID, bundled)
      const fetchedAt = Date.now()
      await this.cacheProvider(provider, { fetchedAt, source: 'snapshot' })
      return {
        provider,
        fetchedAt,
        source: 'snapshot',
        offline: true,
        error,
      }
    }
  }

  async getCachedProvider(providerID: string): Promise<ProviderDiscoveryResult | null> {
    const cached = await this.getCacheEntry(providerID)
    if (!cached) return null
    return {
      provider: cached.provider,
      fetchedAt: cached.fetchedAt,
      source: 'cache',
      offline: false,
    }
  }

  async cacheProvider(
    provider: ProviderInfo,
    opts?: { fetchedAt?: number; source?: Exclude<ModelDiscoverySource, 'cache'> },
  ): Promise<void> {
    const cache = await this.readCache()
    cache.providers[provider.id] = {
      provider,
      fetchedAt: opts?.fetchedAt ?? Date.now(),
      source: opts?.source ?? 'network',
    }
    await this.storage.setLocal(MODELS_CACHE_KEY, cache)
  }

  async removeCachedProvider(providerID: string): Promise<void> {
    const cache = await this.readCache()
    delete cache.providers[providerID]
    await this.storage.setLocal(MODELS_CACHE_KEY, cache)
  }

  private async getCacheEntry(providerID: string): Promise<ProviderModelsCacheEntry | null> {
    return (await this.readCache()).providers[providerID] ?? null
  }

  private async readCache(): Promise<ModelsCacheEntry> {
    const cached = await this.storage.getLocal<unknown>(MODELS_CACHE_KEY)
    if (
      cached &&
      typeof cached === 'object' &&
      'providers' in cached &&
      cached.providers &&
      typeof cached.providers === 'object'
    ) {
      return {
        providers: { ...(cached.providers as Record<string, ProviderModelsCacheEntry>) },
      }
    }
    // Deliberately ignore the legacy full-catalog cache.
    return { providers: {} }
  }
}
