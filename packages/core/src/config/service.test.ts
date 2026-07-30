import { describe, expect, it } from 'vitest'
import { ConfigService } from './service.js'
import {
  CONFIG_LOCAL_KEY,
  CONFIG_SYNC_KEY,
  createMemoryStorage,
  stripSecrets,
  type StorageAdapter,
} from './storage.js'

describe('stripSecrets', () => {
  it('removes apiKey from provider options', () => {
    const cleaned = stripSecrets({
      provider: {
        openai: {
          options: {
            apiKey: 'sk-secret',
            headers: { a: '1', Authorization: 'Bearer secret', 'X-Api-Key': 'secret' },
          },
        },
      },
    })
    expect(
      (cleaned.provider as { openai: { options: { apiKey?: string } } }).openai.options.apiKey,
    ).toBeUndefined()
    expect(
      (cleaned.provider as { openai: { options: { headers: Record<string, string> } } }).openai
        .options.headers.a,
    ).toBe('1')
    const headers = (
      cleaned.provider as { openai: { options: { headers: Record<string, string> } } }
    ).openai.options.headers
    expect(headers.Authorization).toBeUndefined()
    expect(headers['X-Api-Key']).toBeUndefined()
  })
})

describe('ConfigService', () => {
  it('returns defaults when empty', async () => {
    const svc = new ConfigService(createMemoryStorage())
    const cfg = await svc.get()
    expect(cfg.executionMode).toBe('approval')
  })

  it('round-trips developer mode through storage and service reinstantiation', async () => {
    const storage = createMemoryStorage()
    const svc = new ConfigService(storage)
    await svc.set({ settings: { developerMode: true } })

    const rehydrated = new ConfigService(storage)
    expect((await rehydrated.get()).settings.developerMode).toBe(true)
  })

  it('serializes concurrent partial patches before persisting', async () => {
    const backing = createMemoryStorage()
    let localReadCount = 0
    let blockFirstRead = true
    let notifyFirstRead: () => void = () => undefined
    let releaseFirstRead: () => void = () => undefined
    const firstRead = new Promise<void>((resolve) => {
      notifyFirstRead = resolve
    })
    const firstReadReleased = new Promise<void>((resolve) => {
      releaseFirstRead = resolve
    })
    const storage: StorageAdapter = {
      getSync: (key) => backing.getSync(key),
      setSync: (key, value) => backing.setSync(key, value),
      getLocal: async <T>(key: string) => {
        const snapshot = await backing.getLocal<T>(key)
        if (key === CONFIG_LOCAL_KEY) {
          localReadCount += 1
          if (blockFirstRead) {
            blockFirstRead = false
            notifyFirstRead()
            await firstReadReleased
          }
        }
        return snapshot
      },
      setLocal: (key, value) => backing.setLocal(key, value),
      removeLocal: (key) => backing.removeLocal(key),
    }
    const svc = new ConfigService(storage)

    const developerModePatch = svc.set({ settings: { developerMode: true } })
    await firstRead
    const executionModePatch = svc.set({ executionMode: 'plan' })
    await new Promise<void>((resolve) => setTimeout(resolve, 0))

    try {
      expect(localReadCount).toBe(1)
    } finally {
      releaseFirstRead()
    }

    await Promise.all([developerModePatch, executionModePatch])
    const persisted = await new ConfigService(backing).get()
    expect(persisted.settings.developerMode).toBe(true)
    expect(persisted.executionMode).toBe('plan')
  })

  it('preserves a concurrent patch while migrating legacy sync config', async () => {
    const backing = createMemoryStorage()
    await backing.setSync(CONFIG_SYNC_KEY, { executionMode: 'plan' })

    let blockFirstLocalWrite = true
    let notifyFirstLocalWrite: () => void = () => undefined
    let releaseFirstLocalWrite: () => void = () => undefined
    const firstLocalWrite = new Promise<void>((resolve) => {
      notifyFirstLocalWrite = resolve
    })
    const firstLocalWriteReleased = new Promise<void>((resolve) => {
      releaseFirstLocalWrite = resolve
    })
    const storage: StorageAdapter = {
      getSync: (key) => backing.getSync(key),
      setSync: (key, value) => backing.setSync(key, value),
      getLocal: (key) => backing.getLocal(key),
      setLocal: async (key, value) => {
        if (key === CONFIG_LOCAL_KEY && blockFirstLocalWrite) {
          blockFirstLocalWrite = false
          notifyFirstLocalWrite()
          await firstLocalWriteReleased
        }
        await backing.setLocal(key, value)
      },
      removeLocal: (key) => backing.removeLocal(key),
    }
    const svc = new ConfigService(storage)

    const migration = svc.get()
    await firstLocalWrite
    const developerModePatch = svc.set({ settings: { developerMode: true } })
    releaseFirstLocalWrite()

    await Promise.all([migration, developerModePatch])
    const persisted = await new ConfigService(backing).get()
    expect(persisted.executionMode).toBe('plan')
    expect(persisted.settings.developerMode).toBe(true)
  })

  it('persists patches to local storage without secrets', async () => {
    const storage = createMemoryStorage()
    const svc = new ConfigService(storage)
    const result = await svc.set({
      executionMode: 'plan',
      provider: {
        openai: { name: 'OpenAI', options: { apiKey: 'sk-leak' } },
      },
    })
    const raw = await storage.getLocal('browser-agent.config.local')
    expect(JSON.stringify(raw)).not.toContain('sk-leak')
    expect(JSON.stringify(result)).not.toContain('sk-leak')
    const cfg = await svc.get()
    expect(cfg.executionMode).toBe('plan')
    expect(cfg.provider.openai?.name).toBe('OpenAI')
  })

  it('migrates sync config into local storage once', async () => {
    const storage = createMemoryStorage()
    await storage.setSync('browser-agent.config', {
      model: 'openai/gpt-4.1',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
    const svc = new ConfigService(storage)
    const cfg = await svc.get()
    expect(cfg.model).toBe('openai/gpt-4.1')
    expect(await storage.getLocal('browser-agent.config.local')).toBeTruthy()

    await svc.set({
      provider: {
        'openai-compatible': {
          enabled: true,
          api: 'https://opencode.ai/zen/go/v1',
          models: { 'minimax-m2.5': { enabled: true } },
        },
      },
    })
    const next = await svc.get()
    expect(next.provider['openai-compatible']?.models['minimax-m2.5']?.enabled).toBe(true)
  })

  it('migrates only a legacy selected model to enabled state', async () => {
    const storage = createMemoryStorage()
    await storage.setLocal('browser-agent.config.local', {
      model: 'openai/gpt-4.1',
      provider: { openai: { name: 'OpenAI' } },
    })
    const cfg = await new ConfigService(storage).get()
    expect(cfg.provider.openai?.enabled).toBe(true)
    expect(cfg.provider.openai?.models['gpt-4.1']?.enabled).toBe(true)
    expect(Object.keys(cfg.provider.openai?.models ?? {})).toEqual(['gpt-4.1'])
  })
})
