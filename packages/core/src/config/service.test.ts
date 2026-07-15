import { describe, expect, it } from 'vitest'
import { ConfigService } from './service.js'
import { createMemoryStorage, stripSecrets } from './storage.js'

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

  it('persists patches without secrets in sync store', async () => {
    const storage = createMemoryStorage()
    const svc = new ConfigService(storage)
    const result = await svc.set({
      executionMode: 'plan',
      provider: {
        openai: { name: 'OpenAI', options: { apiKey: 'sk-leak' } },
      },
    })
    const raw = await storage.getSync('browser-agent.config')
    expect(JSON.stringify(raw)).not.toContain('sk-leak')
    expect(JSON.stringify(result)).not.toContain('sk-leak')
    const cfg = await svc.get()
    expect(cfg.executionMode).toBe('plan')
    expect(cfg.provider.openai?.name).toBe('OpenAI')
  })

  it('migrates only a legacy selected model to enabled state', async () => {
    const storage = createMemoryStorage()
    await storage.setSync('browser-agent.config', {
      model: 'openai/gpt-4.1',
      provider: { openai: { name: 'OpenAI' } },
    })
    const cfg = await new ConfigService(storage).get()
    expect(cfg.provider.openai?.enabled).toBe(true)
    expect(cfg.provider.openai?.models['gpt-4.1']?.enabled).toBe(true)
    expect(Object.keys(cfg.provider.openai?.models ?? {})).toEqual(['gpt-4.1'])
  })
})
