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
    cancelOAuth: vi.fn().mockResolvedValue(undefined),
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

  it('falls back to a watched authorization tab when the identity callback fails', async () => {
    const sessionState: Record<string, unknown> = {}
    const updatedListeners = new Set<
      (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => void
    >()
    const removedListeners = new Set<(tabId: number) => void>()
    vi.stubGlobal('chrome', {
      runtime: { lastError: { message: 'Identity flow is unavailable' } },
      identity: {
        getRedirectURL: vi.fn(() => 'https://extension.chromiumapp.org/mcp'),
        launchWebAuthFlow: vi.fn((_options, callback) => callback(undefined)),
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionState[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(sessionState, value)),
        },
      },
      tabs: {
        create: vi.fn(async () => ({ id: 42 })),
        remove: vi.fn(async () => undefined),
        onUpdated: {
          addListener: vi.fn((listener) => updatedListeners.add(listener)),
          removeListener: vi.fn((listener) => updatedListeners.delete(listener)),
        },
        onRemoved: {
          addListener: vi.fn((listener) => removedListeners.add(listener)),
          removeListener: vi.fn((listener) => removedListeners.delete(listener)),
        },
      },
    })

    const oauthRegistry = {
      ...registry,
      beginOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://auth.example/authorize?state=test-state',
        state: 'test-state',
        redirectUrl: 'https://extension.chromiumapp.org/mcp',
        generation: 'attempt-one',
        usesConfiguredClient: false,
      }),
      completeOAuth: vi.fn().mockResolvedValue({
        ok: true,
        serverId: 'oauth',
        checkedAt: 1,
      }),
    } as unknown as RemoteMcpRegistry
    const oauthBus = createMessageBus()
    registerMcpHandlers(oauthBus, { config, vault, registry: oauthRegistry, marketplace })

    const response = await dispatchMcpMessage(
      oauthBus,
      createRequest('mcp.oauth.connect', { id: 'oauth' }),
    )

    expect(response.payload).toEqual({
      ok: true,
      pending: true,
      manual: true,
      generation: 'attempt-one',
    })
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: 'https://auth.example/authorize?state=test-state',
      active: true,
    })
    expect(updatedListeners).toHaveLength(1)

    for (const listener of updatedListeners) {
      listener(
        42,
        { url: 'https://extension.chromiumapp.org/mcp?code=test-code&state=test-state' },
        {
          id: 42,
          url: 'https://extension.chromiumapp.org/mcp?code=test-code&state=test-state',
        } as chrome.tabs.Tab,
      )
    }
    await vi.waitFor(() => {
      expect(oauthRegistry.completeOAuth).toHaveBeenCalledWith(
        'oauth',
        'https://extension.chromiumapp.org/mcp?code=test-code&state=test-state',
        'https://extension.chromiumapp.org/mcp',
        'attempt-one',
      )
      expect(chrome.tabs.remove).toHaveBeenCalledWith(42)
      expect(sessionState['browser-agent.mcp-oauth-pending']).toEqual({})
    })

    expect(JSON.stringify(sessionState)).not.toContain('test-code')
    expect(removedListeners).toHaveLength(0)
    vi.unstubAllGlobals()
  })

  it('surfaces a manual OAuth completion result after the identity callback fallback', async () => {
    const sessionState: Record<string, unknown> = {}
    vi.stubGlobal('chrome', {
      runtime: { lastError: { message: 'Identity flow is unavailable' } },
      identity: {
        getRedirectURL: vi.fn(() => 'https://extension.chromiumapp.org/mcp'),
        launchWebAuthFlow: vi.fn((_options, callback) => callback(undefined)),
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionState[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(sessionState, value)),
        },
      },
      tabs: {
        create: vi.fn(async () => ({ id: 42 })),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    })
    const oauthRegistry = {
      ...registry,
      beginOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://auth.example/authorize',
        state: 'pending-state',
        redirectUrl: 'https://extension.chromiumapp.org/mcp',
        generation: 'manual-attempt',
        usesConfiguredClient: false,
      }),
      completeOAuth: vi.fn().mockResolvedValue({
        ok: true,
        serverId: 'oauth',
        checkedAt: 1,
        transport: 'streamable-http',
      }),
      cancelOAuth: vi.fn().mockResolvedValue(undefined),
    } as unknown as RemoteMcpRegistry
    const oauthBus = createMessageBus()
    registerMcpHandlers(oauthBus, { config, vault, registry: oauthRegistry, marketplace })

    const pending = await dispatchMcpMessage(
      oauthBus,
      createRequest('mcp.oauth.connect', { id: 'oauth' }),
    )
    expect(pending.payload).toEqual({
      ok: true,
      pending: true,
      manual: true,
      generation: 'manual-attempt',
    })

    const listed = await dispatchMcpMessage(oauthBus, createRequest('mcp.server.list'))
    expect((listed.payload as { oauthPending?: unknown[] }).oauthPending).toEqual([
      expect.objectContaining({ serverId: 'oauth' }),
    ])
    expect(JSON.stringify(listed.payload)).not.toContain('pending-state')

    const completed = await dispatchMcpMessage(
      oauthBus,
      createRequest('mcp.oauth.complete', {
        id: 'oauth',
        callbackUrl: 'https://extension.chromiumapp.org/mcp?code=one-time-code&state=pending-state',
        generation: 'manual-attempt',
      }),
    )
    expect(completed.type).toBe('mcp.oauth.complete')
    expect(completed.payload).toMatchObject({
      ok: true,
      health: { ok: true, transport: 'streamable-http' },
    })
    expect(oauthRegistry.completeOAuth).toHaveBeenCalledWith(
      'oauth',
      'https://extension.chromiumapp.org/mcp?code=one-time-code&state=pending-state',
      'https://extension.chromiumapp.org/mcp',
      'manual-attempt',
    )
    expect(sessionState['browser-agent.mcp-oauth-pending']).toEqual({})
    vi.unstubAllGlobals()
  })

  it('does not expose OAuth endpoint credentials when completion fails', async () => {
    const exposedAccess = crypto.randomUUID()
    const exposedRefresh = crypto.randomUUID()
    const exposedClientSecret = crypto.randomUUID()
    const sessionState: Record<string, unknown> = {}
    vi.stubGlobal('chrome', {
      identity: {
        getRedirectURL: vi.fn(() => 'https://extension.chromiumapp.org/mcp'),
        launchWebAuthFlow: vi.fn(),
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionState[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(sessionState, value)),
        },
      },
      tabs: {
        create: vi.fn(async () => ({ id: 42 })),
        onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    })
    const oauthRegistry = {
      ...registry,
      beginOAuth: vi.fn().mockResolvedValue({
        authorizationUrl: 'https://auth.example/authorize',
        state: 'pending-state',
        redirectUrl: 'https://app.example/oauth/callback',
        generation: 'adversarial-attempt',
        usesConfiguredClient: true,
      }),
      completeOAuth: vi.fn().mockRejectedValue(
        new Error(
          `token endpoint response: {"access_token":"${exposedAccess}","refresh_token":"${exposedRefresh}","client_secret":"${exposedClientSecret}"}`,
        ),
      ),
      cancelOAuth: vi.fn().mockResolvedValue(undefined),
    } as unknown as RemoteMcpRegistry
    const oauthBus = createMessageBus()
    registerMcpHandlers(oauthBus, { config, vault, registry: oauthRegistry, marketplace })

    await dispatchMcpMessage(oauthBus, createRequest('mcp.oauth.connect', { id: 'oauth' }))
    const completed = await dispatchMcpMessage(
      oauthBus,
      createRequest('mcp.oauth.complete', {
        id: 'oauth',
        callbackUrl: 'https://app.example/oauth/callback?code=one-time-code&state=pending-state',
        generation: 'adversarial-attempt',
      }),
    )
    const serialized = JSON.stringify(completed)

    expect(completed.payload).toMatchObject({
      ok: false,
      error: {
        code: 'auth',
        message: 'MCP OAuth could not be completed.',
      },
    })
    expect(serialized).not.toContain(exposedAccess)
    expect(serialized).not.toContain(exposedRefresh)
    expect(serialized).not.toContain(exposedClientSecret)
    expect(oauthRegistry.cancelOAuth).toHaveBeenCalled()
    vi.unstubAllGlobals()
  })

  it('returns an actionable result when the provider rejects Chrome OAuth registration', async () => {
    vi.stubGlobal('chrome', {
      identity: { getRedirectURL: vi.fn(() => 'https://extension.chromiumapp.org/mcp') },
    })
    const oauthRegistry = {
      ...registry,
      beginOAuth: vi.fn().mockRejectedValue(
        new McpClientError(
          'This provider does not accept Browser Agent’s dynamic OAuth client or Chrome extension callback.',
          'oauth-redirect',
          undefined,
          'Use a provider-registered public OAuth client or supported token auth.',
        ),
      ),
      cancelOAuth: vi.fn().mockResolvedValue(undefined),
    } as unknown as RemoteMcpRegistry
    const oauthBus = createMessageBus()
    registerMcpHandlers(oauthBus, { config, vault, registry: oauthRegistry, marketplace })

    const response = await dispatchMcpMessage(
      oauthBus,
      createRequest('mcp.oauth.connect', { id: 'oauth' }),
    )

    expect(response.payload).toEqual({
      ok: false,
      error: {
        code: 'oauth-redirect',
        message:
          'This provider does not accept Browser Agent’s dynamic OAuth client or Chrome extension callback.',
        action: 'Use a provider-registered public OAuth client or supported token auth.',
      },
    })
    vi.unstubAllGlobals()
  })

  it('ignores a stale callback after a newer attempt and restores the current watcher', async () => {
    const sessionState: Record<string, unknown> = {}
    const updatedListeners = new Set<
      (
        tabId: number,
        changeInfo: chrome.tabs.TabChangeInfo,
        tab: chrome.tabs.Tab,
      ) => void
    >()
    let nextTabId = 42
    vi.stubGlobal('chrome', {
      runtime: { lastError: { message: 'Identity callback capture failed' } },
      identity: {
        getRedirectURL: vi.fn(() => 'https://extension.chromiumapp.org/mcp'),
        launchWebAuthFlow: vi.fn((_options, callback) => callback(undefined)),
      },
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionState[key] })),
          set: vi.fn(async (value: Record<string, unknown>) => Object.assign(sessionState, value)),
        },
      },
      tabs: {
        create: vi.fn(async () => ({ id: nextTabId++ })),
        remove: vi.fn(async () => undefined),
        onUpdated: {
          addListener: vi.fn((listener) => updatedListeners.add(listener)),
          removeListener: vi.fn((listener) => updatedListeners.delete(listener)),
        },
        onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
      },
    })
    const oauthRegistry = {
      ...registry,
      beginOAuth: vi
        .fn()
        .mockResolvedValueOnce({
          authorizationUrl: 'https://auth.example/authorize?attempt=one',
          state: 'first-state',
          redirectUrl: 'https://extension.chromiumapp.org/mcp',
          generation: 'first-generation',
          usesConfiguredClient: false,
        })
        .mockResolvedValueOnce({
          authorizationUrl: 'https://auth.example/authorize?attempt=two',
          state: 'second-state',
          redirectUrl: 'https://extension.chromiumapp.org/mcp',
          generation: 'second-generation',
          usesConfiguredClient: false,
        }),
      completeOAuth: vi.fn().mockResolvedValue({
        ok: true,
        serverId: 'oauth',
        checkedAt: 1,
      }),
      cancelOAuth: vi.fn().mockResolvedValue(true),
    } as unknown as RemoteMcpRegistry
    const oauthBus = createMessageBus()
    registerMcpHandlers(oauthBus, { config, vault, registry: oauthRegistry, marketplace })

    await dispatchMcpMessage(oauthBus, createRequest('mcp.oauth.connect', { id: 'oauth' }))
    const staleListener = [...updatedListeners][0]!
    await dispatchMcpMessage(oauthBus, createRequest('mcp.oauth.connect', { id: 'oauth' }))

    staleListener(
      42,
      { url: 'https://extension.chromiumapp.org/mcp?code=stale&state=first-state' },
      { id: 42, url: 'https://extension.chromiumapp.org/mcp?code=stale&state=first-state' } as chrome.tabs.Tab,
    )
    await Promise.resolve()
    expect(oauthRegistry.completeOAuth).not.toHaveBeenCalled()

    const restoredBus = createMessageBus()
    registerMcpHandlers(restoredBus, { config, vault, registry: oauthRegistry, marketplace })
    await vi.waitFor(() => expect(updatedListeners).toHaveLength(1))
    const currentListener = [...updatedListeners][0]!
    currentListener(
      43,
      { url: 'https://extension.chromiumapp.org/mcp?code=current&state=second-state' },
      { id: 43, url: 'https://extension.chromiumapp.org/mcp?code=current&state=second-state' } as chrome.tabs.Tab,
    )
    await vi.waitFor(() => {
      expect(oauthRegistry.completeOAuth).toHaveBeenCalledWith(
        'oauth',
        'https://extension.chromiumapp.org/mcp?code=current&state=second-state',
        'https://extension.chromiumapp.org/mcp',
        'second-generation',
      )
    })
    vi.unstubAllGlobals()
  })
})
