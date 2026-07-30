import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '../config/service.js'
import { createMemoryStorage } from '../config/storage.js'
import { CredentialVault } from '../vault/vault.js'
import { RemoteMcpRegistry } from './registry.js'

function jsonRpcFetch() {
  return vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (init?.method === 'DELETE') return new Response(null, { status: 200 })
    if (init?.method === 'GET') return new Response(null, { status: 405 })
    const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    const request = Array.isArray(raw) ? raw[0] : raw
    if (request?.id === undefined) return new Response(null, { status: 202 })

    let result: unknown
    switch (request.method) {
      case 'initialize':
        result = {
          protocolVersion: '2025-11-25',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'mock-mcp', version: '2.4.0' },
        }
        break
      case 'ping':
        result = {}
        break
      case 'tools/list':
        result = {
          tools: [
            {
              name: 'lookup',
              description: 'Read a record',
              inputSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
              },
              annotations: {
                readOnlyHint: true,
                destructiveHint: false,
                idempotentHint: true,
                openWorldHint: false,
              },
            },
            {
              name: 'delete',
              description: 'Delete a record',
              inputSchema: { type: 'object' },
              annotations: { destructiveHint: true },
            },
          ],
        }
        break
      case 'resources/list':
        result = { resources: [{ uri: 'mock://guide', name: 'Guide', mimeType: 'text/plain' }] }
        break
      case 'prompts/list':
        result = { prompts: [{ name: 'summarize', description: 'Summarize a record' }] }
        break
      case 'resources/read':
        result = {
          contents: [{ uri: request.params.uri, text: 'Resource at https://example.com/guide' }],
        }
        break
      case 'tools/call':
        result =
          request.params.name === 'delete'
            ? { isError: true, content: [{ type: 'text', text: 'Delete rejected' }] }
            : {
                content: [{ type: 'text', text: `Found ${request.params.arguments.id}` }],
                structuredContent: { found: true },
              }
        break
      default:
        return Response.json(
          { jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Unknown method' } },
          { headers: { 'mcp-session-id': 'test-session' } },
        )
    }
    return Response.json(
      { jsonrpc: '2.0', id: request.id, result },
      {
        headers: {
          'content-type': 'application/json',
          'mcp-session-id': 'test-session',
        },
      },
    )
  })
}

async function setup(fetchImpl = jsonRpcFetch()) {
  const storage = createMemoryStorage()
  const config = new ConfigService(storage)
  const vault = new CredentialVault(storage)
  await config.set({
    mcp: {
      mock: {
        name: 'Mock',
        url: 'https://mcp.example.test/mcp',
        transport: 'streamable-http',
        enabled: true,
      },
    },
  })
  const registry = new RemoteMcpRegistry(config, vault, storage, {
    fetch: fetchImpl as typeof fetch,
    idleMs: 60_000,
  })
  return { storage, config, vault, registry, fetchImpl }
}

describe('RemoteMcpRegistry', () => {
  it('initializes, discovers annotations/resources/prompts, calls tools, and restores cache', async () => {
    const { storage, config, vault, registry } = await setup()
    const health = await registry.testConnection('mock')
    expect(health).toMatchObject({
      ok: true,
      transport: 'streamable-http',
      protocolVersion: '2025-11-25',
      serverVersion: { name: 'mock-mcp', version: '2.4.0' },
    })

    const discovery = await registry.discover('mock')
    expect(discovery.tools[0]).toMatchObject({
      name: 'lookup',
      annotations: { readOnlyHint: true, idempotentHint: true },
    })
    expect(discovery.resources).toHaveLength(1)
    expect(discovery.prompts).toHaveLength(1)

    const result = await registry.callTool('mock', 'lookup', { id: '42' })
    expect(result).toMatchObject({
      _mcp: { serverId: 'mock', toolName: 'lookup', isError: false },
      summary: 'Found 42',
      structuredContent: { found: true },
    })
    const toolError = await registry.callTool('mock', 'delete', {})
    expect(toolError.error).toBe('Delete rejected')

    const resource = await registry.readResource('mock', 'mock://guide')
    expect(JSON.stringify(resource)).toContain('https://example.com/guide')

    await registry.closeAll()
    const afterRestart = new RemoteMcpRegistry(config, vault, storage)
    expect((await afterRestart.getCachedDiscovery('mock'))?.serverVersion?.version).toBe('2.4.0')
  })

  it('falls back to legacy SSE only after a compatible Streamable HTTP failure', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    await config.set({
      mcp: {
        legacy: {
          name: 'Legacy',
          url: 'https://legacy.example.test/sse',
          transport: 'auto',
        },
      },
    })
    const attempts: string[] = []
    const fakeClient = {
      ping: vi.fn().mockResolvedValue({}),
      getServerVersion: () => ({ name: 'legacy', version: '1.0.0' }),
    } as unknown as Client
    const fakeTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    } as unknown as Transport
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      connectionFactory: async ({ kind }) => {
        attempts.push(kind)
        if (kind === 'streamable-http') throw new StreamableHTTPError(405, 'Method Not Allowed')
        return { client: fakeClient, transport: fakeTransport }
      },
    })

    const health = await registry.testConnection('legacy')
    expect(health).toMatchObject({ ok: true, transport: 'sse' })
    expect(attempts).toEqual(['streamable-http', 'sse'])
    await registry.closeAll()
  })

  it('does not fall back to SSE for authentication failures', async () => {
    const { storage, config, vault } = await setup()
    await config.set({
      mcp: { mock: { transport: 'auto', auth: { mode: 'bearer' } } },
    })
    await vault.setMcp('mock', 'test-bearer-credential', 'api')
    const attempts: string[] = []
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      connectionFactory: async ({ kind }) => {
        attempts.push(kind)
        throw new StreamableHTTPError(401, 'Unauthorized')
      },
    })
    const health = await registry.testConnection('mock')
    expect(health).toMatchObject({ ok: false, error: { code: 'auth' } })
    expect(attempts).toEqual(['streamable-http'])
  })

  it('does not fall back to SSE for an unreachable Streamable HTTP endpoint', async () => {
    const { storage, config, vault } = await setup()
    await config.set({ mcp: { mock: { transport: 'auto' } } })
    const attempts: string[] = []
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      connectionFactory: async ({ kind }) => {
        attempts.push(kind)
        throw new Error('Failed to fetch')
      },
    })

    const health = await registry.testConnection('mock')

    expect(health).toMatchObject({
      ok: false,
      error: {
        code: 'network',
        action: expect.stringContaining('does not distinguish'),
      },
    })
    expect(attempts).toEqual(['streamable-http'])
  })

  it('returns stable actionable health categories without exposing credentials', async () => {
    const { storage, config, vault } = await setup()
    const cases: Array<{
      error: Error
      code: 'auth' | 'cors' | 'network' | 'transport'
      action: string
    }> = [
      {
        error: new StreamableHTTPError(401, 'Authorization: Bearer test-health-value'),
        code: 'auth',
        action: 'Save a valid bearer/API credential',
      },
      {
        error: new Error('CORS blocked Authorization: Bearer test-health-value'),
        code: 'cors',
        action: 'Allow the extension origin',
      },
      {
        error: new Error('Failed to fetch'),
        code: 'network',
        action: 'Browser fetch reports this same opaque failure',
      },
      {
        error: new StreamableHTTPError(415, 'Unsupported Media Type'),
        code: 'transport',
        action: 'Use Auto only',
      },
    ]

    for (const { error, code, action } of cases) {
      const registry = new RemoteMcpRegistry(config, vault, storage, {
        connectionFactory: async () => {
          throw error
        },
      })
      const health = await registry.testConnection('mock')
      expect(health).toMatchObject({
        ok: false,
        error: { code, action: expect.stringContaining(action) },
      })
      expect(JSON.stringify(health)).not.toContain('test-health-value')
    }
  })

  it('reconnects after idle close and rereads a vaulted bearer credential after a worker restart', async () => {
    vi.useFakeTimers()
    try {
      const storage = createMemoryStorage()
      const config = new ConfigService(storage)
      const vault = new CredentialVault(storage)
      await config.set({
        mcp: {
          retained: {
            url: 'https://mcp.example.test/mcp',
            transport: 'streamable-http',
            auth: { mode: 'bearer' },
          },
        },
      })
      await vault.setMcp('retained', 'test-retained-credential', 'api')

      const headersSeen: Array<Record<string, string>> = []
      const makeRegistry = () =>
        new RemoteMcpRegistry(config, vault, storage, {
          idleMs: 10,
          connectionFactory: async ({ headers }) => {
            headersSeen.push(headers)
            const transport = {
              close: vi.fn(async () => {
                transport.onclose?.()
              }),
            } as unknown as Transport
            return {
              client: {
                ping: vi.fn().mockResolvedValue({}),
                getServerVersion: () => ({ name: 'retained', version: '1.0.0' }),
              } as unknown as Client,
              transport,
            }
          },
        })

      const registry = makeRegistry()
      expect((await registry.testConnection('retained')).ok).toBe(true)
      await vi.advanceTimersByTimeAsync(10)
      expect(headersSeen).toHaveLength(1)

      expect((await registry.testConnection('retained')).ok).toBe(true)
      expect(headersSeen).toHaveLength(2)

      const restartedWorkerRegistry = makeRegistry()
      expect((await restartedWorkerRegistry.testConnection('retained')).ok).toBe(true)
      expect(headersSeen).toHaveLength(3)
      expect(headersSeen).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ Authorization: 'Bearer test-retained-credential' }),
        ]),
      )
      expect((await vault.getMcp('retained', 'api'))?.secret).toBe('test-retained-credential')
      await Promise.all([registry.closeAll(), restartedWorkerRegistry.closeAll()])
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not idle-close a shared connection while a concurrent tool call still holds a lease', async () => {
    vi.useFakeTimers()
    try {
      const storage = createMemoryStorage()
      const config = new ConfigService(storage)
      const vault = new CredentialVault(storage)
      await config.set({
        mcp: {
          mock: {
            url: 'https://mcp.example.test/mcp',
            transport: 'streamable-http',
          },
        },
      })
      let startLongCall!: () => void
      let completeLongCall!: (value: unknown) => void
      const longCallStarted = new Promise<void>((resolve) => {
        startLongCall = resolve
      })
      const longCall = new Promise<unknown>((resolve) => {
        completeLongCall = resolve
      })
      const close = vi.fn().mockResolvedValue(undefined)
      const transport = { close } as unknown as Transport
      const client = {
        ping: vi.fn().mockResolvedValue({}),
        getServerVersion: () => ({ name: 'mock', version: '1.0.0' }),
        callTool: vi.fn(() => {
          startLongCall()
          return longCall
        }),
      } as unknown as Client
      const registry = new RemoteMcpRegistry(config, vault, storage, {
        idleMs: 10,
        connectionFactory: async () => ({ client, transport }),
      })

      const inFlight = registry.callTool('mock', 'lookup', { id: '42' })
      await longCallStarted
      expect((await registry.testConnection('mock')).ok).toBe(true)

      await vi.advanceTimersByTimeAsync(10)
      expect(close).not.toHaveBeenCalled()

      completeLongCall({ content: [{ type: 'text', text: 'Found 42' }] })
      await expect(inFlight).resolves.toMatchObject({ summary: 'Found 42' })
      await vi.advanceTimersByTimeAsync(10)
      expect(close).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})
