import {
  DEFAULT_CONFIG,
  mergeConfig,
  parseConfig,
  type AppConfig,
  type AppConfigPatch,
} from './schema.js'
import { CONFIG_SYNC_KEY, stripSecrets, type StorageAdapter } from './storage.js'

export class ConfigService {
  constructor(private readonly storage: StorageAdapter) {}

  async get(): Promise<AppConfig> {
    const stored = await this.storage.getSync<unknown>(CONFIG_SYNC_KEY)
    if (!stored) return DEFAULT_CONFIG
    return mergeConfig(DEFAULT_CONFIG, migrateStoredConfig(stored))
  }

  async set(patch: AppConfigPatch): Promise<AppConfig> {
    const current = await this.get()
    const next = mergeConfig(current, patch)
    const safe = stripSecrets(next as unknown as Record<string, unknown>)
    await this.storage.setSync(CONFIG_SYNC_KEY, safe)
    return parseConfig(safe)
  }

  async reset(): Promise<AppConfig> {
    await this.storage.setSync(
      CONFIG_SYNC_KEY,
      stripSecrets(DEFAULT_CONFIG as unknown as Record<string, unknown>),
    )
    return DEFAULT_CONFIG
  }
}

/**
 * Preserve a legacy selected model without globally enabling a catalog. Only
 * the single previously selected provider/model is migrated. Explicitly
 * disabled providers or models clear a stale legacy default.
 */
function migrateStoredConfig(stored: unknown): AppConfigPatch {
  if (!stored || typeof stored !== 'object') return {}
  const clone = structuredClone(stored) as Record<string, unknown>
  const model = typeof clone.model === 'string' ? clone.model : undefined
  if (!model) return clone as AppConfigPatch

  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) return clone as AppConfigPatch
  const providerID = model.slice(0, slash)
  const modelID = model.slice(slash + 1)
  const providers =
    clone.provider && typeof clone.provider === 'object'
      ? (clone.provider as Record<string, Record<string, unknown>>)
      : {}
  const provider = providers[providerID] ?? {}
  const models =
    provider.models && typeof provider.models === 'object'
      ? (provider.models as Record<string, Record<string, unknown>>)
      : {}
  const modelConfig = models[modelID] ?? {}

  if (provider.enabled === false || modelConfig.enabled === false) {
    delete clone.model
    return clone as AppConfigPatch
  }

  provider.enabled ??= true
  modelConfig.enabled ??= true
  models[modelID] = modelConfig
  provider.models = models
  providers[providerID] = provider
  clone.provider = providers
  return clone as AppConfigPatch
}
