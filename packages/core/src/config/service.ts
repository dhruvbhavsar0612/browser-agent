import { DEFAULT_CONFIG, mergeConfig, parseConfig, type AppConfig } from './schema.js'
import {
  CONFIG_SYNC_KEY,
  stripSecrets,
  type StorageAdapter,
} from './storage.js'

export class ConfigService {
  constructor(private readonly storage: StorageAdapter) {}

  async get(): Promise<AppConfig> {
    const stored = await this.storage.getSync<unknown>(CONFIG_SYNC_KEY)
    if (!stored) return DEFAULT_CONFIG
    return mergeConfig(DEFAULT_CONFIG, parseConfig({ ...DEFAULT_CONFIG, ...(stored as object) }))
  }

  async set(patch: Partial<AppConfig>): Promise<AppConfig> {
    const current = await this.get()
    const next = mergeConfig(current, patch)
    const safe = stripSecrets(next as unknown as Record<string, unknown>)
    await this.storage.setSync(CONFIG_SYNC_KEY, safe)
    return next
  }

  async reset(): Promise<AppConfig> {
    await this.storage.setSync(CONFIG_SYNC_KEY, stripSecrets(DEFAULT_CONFIG as unknown as Record<string, unknown>))
    return DEFAULT_CONFIG
  }
}
