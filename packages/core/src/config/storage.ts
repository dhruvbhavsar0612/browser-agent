/** Strip secrets before writing to chrome.storage.sync */
export function stripSecrets<T extends Record<string, unknown>>(input: T): T {
  const clone = structuredClone(input) as Record<string, unknown>
  const provider = clone.provider
  if (provider && typeof provider === 'object') {
    for (const entry of Object.values(provider as Record<string, Record<string, unknown>>)) {
      if (entry?.options && typeof entry.options === 'object') {
        const options = entry.options as Record<string, unknown>
        delete options.apiKey
      }
    }
  }
  return clone as T
}

export interface StorageAdapter {
  getSync<T>(key: string): Promise<T | undefined>
  setSync(key: string, value: unknown): Promise<void>
  getLocal<T>(key: string): Promise<T | undefined>
  setLocal(key: string, value: unknown): Promise<void>
  removeLocal(key: string): Promise<void>
}

/** In-memory adapter for unit tests / Node */
export function createMemoryStorage(): StorageAdapter {
  const sync = new Map<string, unknown>()
  const local = new Map<string, unknown>()
  return {
    async getSync(key) {
      return sync.get(key) as never
    },
    async setSync(key, value) {
      sync.set(key, value)
    },
    async getLocal(key) {
      return local.get(key) as never
    },
    async setLocal(key, value) {
      local.set(key, value)
    },
    async removeLocal(key) {
      local.delete(key)
    },
  }
}

declare const chrome: {
  storage: {
    sync: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
    }
    local: {
      get: (keys: string | string[]) => Promise<Record<string, unknown>>
      set: (items: Record<string, unknown>) => Promise<void>
      remove: (keys: string | string[]) => Promise<void>
    }
  }
}

/** Chrome extension storage adapter */
export function createChromeStorage(): StorageAdapter {
  return {
    async getSync(key) {
      const result = await chrome.storage.sync.get(key)
      return result[key] as never
    },
    async setSync(key, value) {
      await chrome.storage.sync.set({ [key]: value })
    },
    async getLocal(key) {
      const result = await chrome.storage.local.get(key)
      return result[key] as never
    },
    async setLocal(key, value) {
      await chrome.storage.local.set({ [key]: value })
    },
    async removeLocal(key) {
      await chrome.storage.local.remove(key)
    },
  }
}

export const CONFIG_SYNC_KEY = 'browser-agent.config'
export const MODELS_CACHE_KEY = 'browser-agent.models-dev'
export const VAULT_LOCAL_KEY = 'browser-agent.vault'
/** Exported AES key material for vault wrapping (local only — never sync) */
export const VAULT_META_KEY = 'browser-agent.vault-meta'
