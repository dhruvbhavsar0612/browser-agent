import {
  ConfigService,
  CredentialVault,
  ModelsDevService,
  createMemoryStorage,
  createRequest,
  generateText,
  getBundledSnapshot,
} from '@browser-agent/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageBus } from '../bus.js'
import {
  dispatchSettingsMessage,
  formatModelRef,
  parseModelRef,
  registerSettingsHandlers,
  runModelTest,
} from './settings.js'

vi.mock('@browser-agent/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@browser-agent/core')>()
  return {
    ...actual,
    generateText: vi.fn(),
  }
})

const generateTextMock = vi.mocked(generateText)

describe('settings model ref', () => {
  it('parses and formats provider/model ids', () => {
    expect(parseModelRef('openai/gpt-4.1')).toEqual({
      providerID: 'openai',
      modelID: 'gpt-4.1',
    })
    expect(formatModelRef('anthropic', 'claude-sonnet-4-20250514')).toBe(
      'anthropic/claude-sonnet-4-20250514',
    )
  })

  it('rejects invalid model refs', () => {
    expect(() => parseModelRef('no-slash')).toThrow(/providerID\/modelID/)
    expect(() => parseModelRef('/only-model')).toThrow()
    expect(() => parseModelRef('provider/')).toThrow()
  })
})

describe('settings handlers', () => {
  const storage = createMemoryStorage()
  const vault = new CredentialVault(storage)
  const config = new ConfigService(storage)
  const models = new ModelsDevService(storage, async () =>
    Response.json(getBundledSnapshot()),
  )
  const bus = createMessageBus()

  beforeEach(async () => {
    await vault.clear()
    await config.reset()
    generateTextMock.mockReset()
    registerSettingsHandlers(bus, { vault, models, config })
  })

  it('stores and lists vault credentials without secrets', async () => {
    const setRes = await dispatchSettingsMessage(
      bus,
      createRequest('vault.set', { providerId: 'openai', secret: 'sk-test' }),
    )
    expect(setRes.type).toBe('vault.set')
    expect((setRes.payload as { entries: { providerId: string }[] }).entries).toEqual([
      { providerId: 'openai', type: 'api' },
    ])

    const listRes = await dispatchSettingsMessage(bus, createRequest('vault.list'))
    expect(listRes.type).toBe('vault.list')
    expect(listRes.payload).toEqual({
      entries: [{ providerId: 'openai', type: 'api' }],
    })
    expect(JSON.stringify(listRes.payload)).not.toContain('sk-test')
  })

  it('deletes and clears vault entries', async () => {
    await dispatchSettingsMessage(
      bus,
      createRequest('vault.set', { providerId: 'openai', secret: 'sk-a' }),
    )
    await dispatchSettingsMessage(
      bus,
      createRequest('vault.set', { providerId: 'anthropic', secret: 'sk-b' }),
    )

    const deleteRes = await dispatchSettingsMessage(
      bus,
      createRequest('vault.delete', { providerId: 'openai' }),
    )
    expect((deleteRes.payload as { entries: unknown[] }).entries).toHaveLength(1)

    const clearRes = await dispatchSettingsMessage(bus, createRequest('vault.clear'))
    expect(clearRes.payload).toEqual({ ok: true, entries: [] })
  })

  it('returns models catalog from models.list', async () => {
    const res = await dispatchSettingsMessage(bus, createRequest('models.list'))
    expect(res.type).toBe('models.list')
    const providers = (res.payload as { providers: { id: string }[] }).providers
    expect(providers.some((p) => p.id === 'openai')).toBe(true)
    expect(providers.some((p) => p.id === 'anthropic')).toBe(true)
  })

  it('merges openai-compatible /models into models.list when base URL is set', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/models')) {
        return Response.json({
          object: 'list',
          data: [
            { id: 'minimax-m3', object: 'model', owned_by: 'opencode' },
            { id: 'glm-5', object: 'model', owned_by: 'opencode' },
          ],
        })
      }
      return Response.json(getBundledSnapshot())
    })

    await config.set({
      provider: {
        'openai-compatible': { api: 'https://opencode.ai/zen/go/v1' },
      },
    })
    await vault.set('openai-compatible', 'sk-zen')

    const res = await dispatchSettingsMessage(bus, createRequest('models.list'))
    expect(res.type).toBe('models.list')
    const payload = res.payload as {
      providers: { id: string; models: { id: string }[] }[]
      compatibleError: string | null
    }
    expect(payload.compatibleError).toBeNull()
    const compatible = payload.providers.find((p) => p.id === 'openai-compatible')
    expect(compatible?.models.map((m) => m.id).sort()).toEqual(['glm-5', 'minimax-m3'])
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://opencode.ai/zen/go/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer sk-zen' }),
      }),
    )

    fetchSpy.mockRestore()
  })

  it('runs model.test using vault key and generateText', async () => {
    await vault.set('openai', 'sk-live')
    generateTextMock.mockResolvedValue({ text: 'pong' } as never)

    const res = await dispatchSettingsMessage(
      bus,
      createRequest('model.test', { model: 'openai/gpt-4.1' }),
    )
    expect(res.type).toBe('model.test')
    expect(res.payload).toEqual({ ok: true, text: 'pong' })

    expect(generateTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: 'ping',
        maxOutputTokens: 16,
      }),
    )
  })

  it('uses config.model when model.test has no payload', async () => {
    await config.set({ model: 'openai/gpt-4.1-mini' })
    await vault.set('openai', 'sk-live')
    generateTextMock.mockResolvedValue({ text: 'ok' } as never)

    const res = await dispatchSettingsMessage(bus, createRequest('model.test'))
    expect(res.payload).toEqual({ ok: true, text: 'ok' })
  })

  it('returns structured error from runModelTest without throwing', async () => {
    const result = await runModelTest('openai', 'gpt-4.1', { vault, config })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/Missing API key/)
  })
})
