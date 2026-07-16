import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ConfigService,
  CredentialVault,
  MemorySessionStore,
  createMemoryStorage,
  createRequest,
  getModel,
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
    await config.set({
      model: 'openai/gpt-4.1',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })

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

  it('reconstructs session context from the durable transcript plus newest user message', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    await config.set({
      model: 'openai/gpt-4.1',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-test')
    const sessions = new MemorySessionStore()
    const session = await sessions.createSession({ agent: 'browse' })
    const user = await sessions.appendMessage({ sessionId: session.id, role: 'user' })
    await sessions.appendPart({ messageId: user.id, type: 'text', content: 'durable question' })
    const assistant = await sessions.appendMessage({ sessionId: session.id, role: 'assistant' })
    await sessions.appendPart({
      messageId: assistant.id,
      type: 'reasoning',
      content: 'hidden thought',
    })
    await sessions.appendPart({
      messageId: assistant.id,
      type: 'text',
      content: 'durable answer',
    })
    const bus = createMessageBus()
    registerAgentHandlers(bus, { config, vault, sessions })
    const port = { postMessage: vi.fn() } as unknown as chrome.runtime.Port
    const handler = (bus as unknown as { portHandlers: Map<string, Function> }).portHandlers.get(
      'agent.prompt',
    )

    await handler!(
      createRequest('agent.prompt', {
        sessionId: session.id,
        messages: [
          { role: 'user', content: 'incorrect flattened question' },
          { role: 'assistant', content: 'incorrect flattened answer' },
          { role: 'user', content: 'newest question' },
        ],
      }),
      port,
    )

    expect(vi.mocked(runAgentLoop).mock.calls.at(-1)?.[0].messages).toEqual([
      { role: 'user', content: 'durable question' },
      { role: 'assistant', content: [{ type: 'text', text: 'durable answer' }] },
      { role: 'user', content: 'newest question' },
    ])
    expect(JSON.stringify(vi.mocked(runAgentLoop).mock.calls.at(-1)?.[0].messages)).not.toContain(
      'hidden thought',
    )
    expect(JSON.stringify(vi.mocked(runAgentLoop).mock.calls.at(-1)?.[0].messages)).not.toContain(
      'incorrect flattened',
    )
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
    await config.set({
      model: 'openai/gpt-4.1',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-4.1': { enabled: true } },
        },
      },
    })
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

  it('uses the session model before agent override and global default', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    await config.set({
      model: 'openai/gpt-global',
      provider: {
        openai: {
          enabled: true,
          models: {
            'gpt-global': { enabled: true },
            'gpt-session': { enabled: true },
          },
        },
        anthropic: {
          enabled: true,
          models: { 'claude-agent': { enabled: true } },
        },
      },
      agent: {
        browse: {
          model: { providerID: 'anthropic', modelID: 'claude-agent' },
        },
      },
    })
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-test')
    await vault.set('anthropic', 'sk-test')
    const sessions = new MemorySessionStore()
    const session = await sessions.createSession({
      agent: 'browse',
      model: 'openai/gpt-session',
    })
    const bus = createMessageBus()
    registerAgentHandlers(bus, { config, vault, sessions })
    const handler = (bus as unknown as { portHandlers: Map<string, Function> }).portHandlers.get(
      'agent.prompt',
    )
    const port = { postMessage: vi.fn() } as unknown as chrome.runtime.Port

    await handler!(
      createRequest('agent.prompt', {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      port,
    )

    expect(getModel).toHaveBeenCalledWith(
      'openai',
      'gpt-session',
      expect.objectContaining({ apiKey: 'sk-test' }),
    )
  })

  it('reports a disabled session model without silently changing it', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    await config.set({
      model: 'openai/gpt-enabled',
      provider: {
        openai: {
          enabled: true,
          models: { 'gpt-enabled': { enabled: true } },
        },
      },
    })
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-test')
    const sessions = new MemorySessionStore()
    const session = await sessions.createSession({
      agent: 'browse',
      model: 'openai/gpt-disabled',
    })
    const bus = createMessageBus()
    registerAgentHandlers(bus, { config, vault, sessions })
    const handler = (bus as unknown as { portHandlers: Map<string, Function> }).portHandlers.get(
      'agent.prompt',
    )
    const events: StreamEvent[] = []
    const port = {
      postMessage: vi.fn((envelope: { type?: string; payload?: unknown }) => {
        if (envelope.type === 'stream.event') {
          events.push(parseStreamEvent(envelope.payload))
        }
      }),
    } as unknown as chrome.runtime.Port

    await handler!(
      createRequest('agent.prompt', {
        sessionId: session.id,
        messages: [{ role: 'user', content: 'Hi' }],
      }),
      port,
    )

    expect(events).toEqual([
      {
        kind: 'error',
        message: expect.stringContaining('gpt-disabled'),
      },
    ])
    expect(getModel).not.toHaveBeenCalled()
    expect((await sessions.getSession(session.id))?.model).toBe('openai/gpt-disabled')
  })
})
