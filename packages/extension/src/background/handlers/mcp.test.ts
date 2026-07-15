import {
  ConfigService,
  CredentialVault,
  McpMarketplaceService,
  RemoteMcpRegistry,
  createMemoryStorage,
  createRequest,
  type McpDiscovery,
} from '@browser-agent/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMessageBus } from '../bus.js'
import { dispatchMcpMessage, registerMcpHandlers } from './mcp.js'

const discovery: McpDiscovery = {
  serverId: 'docs',
  serverName: 'Docs',
  serverVersion: { name: 'docs-server', version: '1.2.3' },
  protocolVersion: '2025-11-25',
  transport: 'streamable-http',
  discoveredAt: 1,
  tools: [
    {
      name: 'search',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true },
    },
  ],
  resources: [{ uri: 'docs://guide', name: 'Guide' }],
  prompts: [{ name: 'summarize' }],
}

describe('remote MCP message handlers', () => {
  const storage = createMemoryStorage()
  const config = new ConfigService(storage)
  const vault = new CredentialVault(storage)
  const registry = {
    listCachedDiscoveries: vi.fn().mockResolvedValue([]),
    testConnection: vi.fn().mockResolvedValue({ ok: true, serverId: 'docs', checkedAt: 1 }),
    discover: vi.fn().mockResolvedValue(discovery),
    close: vi.fn().mockResolvedValue(undefined),
    closeAll: vi.fn().mockResolvedValue(undefined),
    clearCachedDiscovery: vi.fn().mockResolvedValue(undefined),
    listResources: vi.fn().mockResolvedValue(discovery.resources),
    readResource: vi.fn().mockResolvedValue({ content: [] }),
    disconnectOAuth: vi.fn().mockResolvedValue(undefined),
  } as unknown as RemoteMcpRegistry
  const marketplace = {
    search: vi.fn().mockResolvedValue([
      {
        id: 'official/docs',
        name: 'Official Docs',
        description: 'Docs connector',
        version: '1.0.0',
        url: 'https://registry.example/mcp',
        transport: 'streamable-http',
        authMode: 'none',
        provenance: { provider: 'official-mcp' },
        manifest: {},
      },
    ]),
  } as unknown as McpMarketplaceService
  const bus = createMessageBus()

  beforeEach(async () => {
    await config.reset()
    await vault.clear()
    vi.clearAllMocks()
    registerMcpHandlers(bus, { config, vault, registry, marketplace })
  })

  it('creates, tests, discovers, filters, and deletes a server', async () => {
    const created = await dispatchMcpMessage(
      bus,
      createRequest('mcp.server.create', {
        id: 'docs',
        server: {
          type: 'remote',
          name: 'Docs',
          url: 'https://mcp.example/mcp',
          transport: 'auto',
          enabled: true,
          headers: {},
          auth: { mode: 'none' },
          tools: {},
        },
      }),
    )
    expect(created.type).toBe('mcp.server.create')

    const tested = await dispatchMcpMessage(bus, createRequest('mcp.server.test', { id: 'docs' }))
    expect(tested.payload).toMatchObject({ ok: true })

    const discovered = await dispatchMcpMessage(
      bus,
      createRequest('mcp.server.discover', { id: 'docs' }),
    )
    expect((discovered.payload as McpDiscovery).tools[0]?.name).toBe('search')
    expect((await config.get()).mcp.docs?.tools.search?.enabled).toBe(true)

    await dispatchMcpMessage(
      bus,
      createRequest('mcp.server.update', {
        id: 'docs',
        patch: { tools: { search: { enabled: false } } },
      }),
    )
    expect((await config.get()).mcp.docs?.tools.search?.enabled).toBe(false)

    await dispatchMcpMessage(bus, createRequest('mcp.server.delete', { id: 'docs' }))
    expect((await config.get()).mcp.docs).toBeUndefined()
    expect(registry.clearCachedDiscovery).toHaveBeenCalledWith('docs')
  })

  it('stores manual secrets only in the MCP vault namespace', async () => {
    await config.set({
      mcp: {
        docs: {
          name: 'Docs',
          url: 'https://mcp.example/mcp',
          auth: { mode: 'bearer' },
        },
      },
    })
    const response = await dispatchMcpMessage(
      bus,
      createRequest('mcp.credential.set', { id: 'docs', secret: 'top-secret' }),
    )
    expect(JSON.stringify(response)).not.toContain('top-secret')
    expect((await vault.getMcp('docs'))?.secret).toBe('top-secret')
    expect(JSON.stringify(await config.get())).not.toContain('top-secret')
  })

  it('searches the canonical registry and imports compatible connector manifests', async () => {
    const searched = await dispatchMcpMessage(
      bus,
      createRequest('mcp.marketplace.search', { query: 'docs' }),
    )
    expect((searched.payload as { connectors: unknown[] }).connectors).toHaveLength(1)
    expect(marketplace.search).toHaveBeenCalledWith(
      'docs',
      expect.objectContaining({ source: 'official' }),
    )

    const imported = await dispatchMcpMessage(
      bus,
      createRequest('mcp.marketplace.import', {
        manifest: {
          schemaVersion: '1.0',
          kind: 'connector',
          id: 'official/docs',
          version: '1.0.0',
          name: 'Official Docs',
          description: 'Docs',
          transport: { streamableHttp: { url: 'https://registry.example/mcp' } },
          auth: { type: 'none' },
          registry: {
            provider: 'official-mcp',
            sourceUrl: 'https://registry.modelcontextprotocol.io/server/docs',
            sourceId: 'official/docs@1.0.0',
          },
        },
      }),
    )
    expect((imported.payload as { id: string }).id).toBe('official-docs')
    expect((await config.get()).mcp['official-docs']?.provenance?.provider).toBe('official-mcp')
  })
})
