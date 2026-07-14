import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConfigService,
  CredentialVault,
  createMemoryStorage,
  createRequest,
  parseStreamEvent,
  runAgentLoop,
  type StreamEvent,
} from '@browser-agent/core'
import { createMessageBus } from '../bus.js'
import { registerAgentHandlers, resetAgentRunsForTests } from './agent.js'

vi.mock('@browser-agent/core', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@browser-agent/core')>()
  return {
    ...mod,
    getModel: vi.fn(async () => ({})),
    runAgentLoop: vi.fn(async ({ onEvent }) => {
      onEvent({ kind: 'text-delta', text: 'Hello' })
      onEvent({ kind: 'text-delta', text: ' world' })
      onEvent({ kind: 'done' })
      return { finishReason: 'stop', stopped: false }
    }),
  }
})

describe('agent handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('chrome', {
      alarms: {
        create: vi.fn(),
        clear: vi.fn(),
      },
    })
    resetAgentRunsForTests()
    vi.mocked(runAgentLoop).mockImplementation(async ({ onEvent }) => {
      onEvent({ kind: 'text-delta', text: 'Hello' })
      onEvent({ kind: 'text-delta', text: ' world' })
      onEvent({ kind: 'done' })
      return { finishReason: 'stop', stopped: false }
    })
  })

  it('streams text deltas for agent.prompt', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    await config.set({ model: 'openai/gpt-4.1' })

    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-test')

    const bus = createMessageBus()
    registerAgentHandlers(bus, { config, vault })

    const events: StreamEvent[] = []
    const port = {
      postMessage: vi.fn((envelope: unknown) => {
        if (
          envelope &&
          typeof envelope === 'object' &&
          'type' in envelope &&
          envelope.type === 'stream.event' &&
          'payload' in envelope
        ) {
          events.push(parseStreamEvent((envelope as { payload: unknown }).payload))
        }
      }),
    } as unknown as chrome.runtime.Port

    const handler = (bus as unknown as { portHandlers: Map<string, Function> }).portHandlers.get(
      'agent.prompt',
    )
    expect(handler).toBeDefined()

    const request = createRequest('agent.prompt', {
      messages: [{ role: 'user', content: 'Hi' }],
    })

    await handler!(request, port)

    expect(events.map((event) => (event.kind === 'text-delta' ? event.text : event.kind))).toEqual([
      'Hello',
      ' world',
      'done',
    ])
    expect(port.postMessage).toHaveBeenCalled()
    expect(runAgentLoop).toHaveBeenCalled()
  })

  it('emits error when no model is configured', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    const bus = createMessageBus()
    registerAgentHandlers(bus, { config, vault })

    const events: StreamEvent[] = []
    const port = {
      postMessage: vi.fn((envelope: unknown) => {
        if (
          envelope &&
          typeof envelope === 'object' &&
          'type' in envelope &&
          envelope.type === 'stream.event' &&
          'payload' in envelope
        ) {
          events.push(parseStreamEvent((envelope as { payload: unknown }).payload))
        }
      }),
    } as unknown as chrome.runtime.Port

    const handler = (bus as unknown as { portHandlers: Map<string, Function> }).portHandlers.get(
      'agent.prompt',
    )
    const request = createRequest('agent.prompt', {
      messages: [{ role: 'user', content: 'Hi' }],
    })

    await handler!(request, port)

    expect(events).toEqual([
      { kind: 'error', message: expect.stringContaining('No model selected') },
    ])
    expect(runAgentLoop).not.toHaveBeenCalled()
  })

  it('aborts an active run via agent.stop', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    await config.set({ model: 'openai/gpt-4.1' })
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-test')

    const bus = createMessageBus()
    registerAgentHandlers(bus, { config, vault })

    const stopHandler = (bus as unknown as { handlers: Map<string, Function> }).handlers.get(
      'agent.stop',
    )
    expect(stopHandler).toBeDefined()

    const response = await stopHandler!(
      createRequest('agent.stop', { id: 'run-1' }),
      {} as chrome.runtime.MessageSender,
    )

    expect(response.type).toBe('agent.stop')
    expect(response.payload).toEqual({ ok: true })
  })
})
