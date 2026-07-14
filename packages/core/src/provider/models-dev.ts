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

export interface ModelsCacheEntry {
  fetchedAt: number
  catalog: ModelsCatalog
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

  async getCatalog(opts?: { forceRefresh?: boolean }): Promise<ModelsCatalog> {
    const cached = await this.storage.getLocal<ModelsCacheEntry>(MODELS_CACHE_KEY)
    const fresh =
      cached && !opts?.forceRefresh && Date.now() - cached.fetchedAt < MODELS_CACHE_TTL_MS
        ? cached.catalog
        : null

    if (fresh) return fresh

    try {
      const res = await this.fetchImpl(MODELS_DEV_URL)
      if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`)
      const json = CatalogSchema.parse(await res.json())
      await this.storage.setLocal(MODELS_CACHE_KEY, {
        fetchedAt: Date.now(),
        catalog: json,
      } satisfies ModelsCacheEntry)
      return json
    } catch {
      if (cached?.catalog) return cached.catalog
      return getBundledSnapshot()
    }
  }

  async listProviders(opts?: { forceRefresh?: boolean }): Promise<ProviderInfo[]> {
    return catalogToProviders(await this.getCatalog(opts))
  }

  async listModels(providerID: string, opts?: { forceRefresh?: boolean }): Promise<ModelInfo[]> {
    const providers = await this.listProviders(opts)
    return providers.find((p) => p.id === providerID)?.models ?? []
  }
}
