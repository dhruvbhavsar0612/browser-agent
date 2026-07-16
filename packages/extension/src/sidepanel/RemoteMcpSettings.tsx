import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  McpDiscovery,
  McpHealth,
  McpMarketplaceConnector,
  McpServerConfigType,
  McpVaultListEntry,
} from '@browser-agent/core'
import { sendRequest } from './client.js'

type ServerMap = Record<string, McpServerConfigType>

type ServerDraft = {
  name: string
  url: string
  transport: McpServerConfigType['transport']
  authMode: McpServerConfigType['auth']['mode']
  headerName: string
  headers: string
}

function responseError(response: Awaited<ReturnType<typeof sendRequest>>): string | null {
  return response.type === 'error'
    ? String((response.payload as { message?: string })?.message ?? 'Remote MCP request failed')
    : null
}

function toDraft(server: McpServerConfigType): ServerDraft {
  return {
    name: server.name ?? '',
    url: server.url,
    transport: server.transport,
    authMode: server.auth.mode,
    headerName: server.auth.headerName ?? '',
    headers: JSON.stringify(server.headers ?? {}, null, 2),
  }
}

export function RemoteMcpSettings() {
  const [servers, setServers] = useState<ServerMap>({})
  const [discoveries, setDiscoveries] = useState<Record<string, McpDiscovery>>({})
  const [credentials, setCredentials] = useState<McpVaultListEntry[]>([])
  const [drafts, setDrafts] = useState<Record<string, ServerDraft>>({})
  const [newServer, setNewServer] = useState({
    id: '',
    name: '',
    url: '',
    transport: 'auto' as McpServerConfigType['transport'],
    authMode: 'none' as McpServerConfigType['auth']['mode'],
  })
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [toolSearch, setToolSearch] = useState<Record<string, string>>({})
  const [health, setHealth] = useState<Record<string, McpHealth>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [marketQuery, setMarketQuery] = useState('')
  const [marketResults, setMarketResults] = useState<McpMarketplaceConnector[]>([])

  const load = useCallback(async () => {
    const response = await sendRequest('mcp.server.list')
    const message = responseError(response)
    if (message) throw new Error(message)
    const payload = response.payload as {
      servers?: ServerMap
      discoveries?: McpDiscovery[]
      credentials?: McpVaultListEntry[]
    }
    const nextServers = payload.servers ?? {}
    setServers(nextServers)
    setDiscoveries(
      Object.fromEntries((payload.discoveries ?? []).map((item) => [item.serverId, item])),
    )
    setCredentials(payload.credentials ?? [])
    setDrafts(
      Object.fromEntries(Object.entries(nextServers).map(([id, server]) => [id, toDraft(server)])),
    )
  }, [])

  useEffect(() => {
    void load().catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
  }, [load])

  async function run<T>(key: string, operation: () => Promise<T>): Promise<T | undefined> {
    setBusy(key)
    setError(null)
    try {
      return await operation()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return undefined
    } finally {
      setBusy(null)
    }
  }

  async function request(type: Parameters<typeof sendRequest>[0], payload?: unknown) {
    const response = await sendRequest(type, payload)
    const message = responseError(response)
    if (message) throw new Error(message)
    return response
  }

  async function createServer() {
    const id = newServer.id.trim().toLowerCase()
    await run('create', async () => {
      await request('mcp.server.create', {
        id,
        server: {
          type: 'remote',
          name: newServer.name.trim() || id,
          url: newServer.url.trim(),
          transport: newServer.transport,
          enabled: true,
          headers: {},
          auth: { mode: newServer.authMode },
          tools: {},
        },
      })
      setNewServer({ id: '', name: '', url: '', transport: 'auto', authMode: 'none' })
      await load()
    })
  }

  async function saveServer(id: string) {
    const draft = drafts[id]
    if (!draft) return
    await run(`save:${id}`, async () => {
      let headers: Record<string, string>
      try {
        const parsed = JSON.parse(draft.headers || '{}')
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
        headers = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([name, value]) => [
            name,
            String(value),
          ]),
        )
      } catch {
        throw new Error('Non-secret headers must be a JSON object of string values')
      }
      await request('mcp.server.update', {
        id,
        patch: {
          name: draft.name.trim() || id,
          url: draft.url.trim(),
          transport: draft.transport,
          headers,
          auth: {
            mode: draft.authMode,
            ...(draft.authMode === 'api-key' && draft.headerName.trim()
              ? { headerName: draft.headerName.trim() }
              : {}),
          },
        },
      })
      await load()
    })
  }

  async function patchServer(id: string, patch: Record<string, unknown>) {
    await run(`patch:${id}`, async () => {
      await request('mcp.server.update', { id, patch })
      await load()
    })
  }

  async function removeServer(id: string) {
    if (!window.confirm(`Remove MCP server "${servers[id]?.name ?? id}" and its credentials?`))
      return
    await run(`delete:${id}`, async () => {
      await request('mcp.server.delete', { id })
      await load()
    })
  }

  async function testServer(id: string) {
    await run(`test:${id}`, async () => {
      const response = await request('mcp.server.test', { id })
      setHealth((current) => ({ ...current, [id]: response.payload as McpHealth }))
    })
  }

  async function discoverServer(id: string) {
    await run(`discover:${id}`, async () => {
      const response = await request('mcp.server.discover', { id })
      const discovery = response.payload as McpDiscovery
      setDiscoveries((current) => ({ ...current, [id]: discovery }))
      await load()
    })
  }

  async function saveCredential(id: string) {
    const secret = tokens[id]?.trim()
    if (!secret) return
    await run(`credential:${id}`, async () => {
      const response = await request('mcp.credential.set', { id, secret })
      setCredentials((response.payload as { credentials?: McpVaultListEntry[] }).credentials ?? [])
      setTokens((current) => ({ ...current, [id]: '' }))
    })
  }

  async function deleteCredential(id: string) {
    await run(`credential:${id}`, async () => {
      const response = await request('mcp.credential.delete', { id })
      setCredentials((response.payload as { credentials?: McpVaultListEntry[] }).credentials ?? [])
    })
  }

  async function connectOAuth(id: string) {
    await run(`oauth:${id}`, async () => {
      const response = await request('mcp.oauth.connect', { id })
      const result = response.payload as { health?: McpHealth }
      if (result.health) setHealth((current) => ({ ...current, [id]: result.health! }))
      await load()
    })
  }

  async function disconnectOAuth(id: string) {
    await run(`oauth:${id}`, async () => {
      await request('mcp.oauth.disconnect', { id })
      await load()
    })
  }

  async function setToolEnabled(id: string, toolName: string, enabled: boolean) {
    await patchServer(id, { tools: { [toolName]: { enabled } } })
  }

  async function setAllTools(id: string, enabled: boolean) {
    const discovery = discoveries[id]
    if (!discovery) return
    await patchServer(id, {
      tools: Object.fromEntries(discovery.tools.map((item) => [item.name, { enabled }])),
    })
  }

  async function searchMarketplace() {
    await run('marketplace', async () => {
      const response = await request('mcp.marketplace.search', {
        query: marketQuery,
        source: 'official',
        limit: 30,
      })
      setMarketResults(
        (response.payload as { connectors?: McpMarketplaceConnector[] }).connectors ?? [],
      )
    })
  }

  async function importConnector(connector: McpMarketplaceConnector) {
    await run(`import:${connector.id}`, async () => {
      await request('mcp.marketplace.import', { manifest: connector.manifest })
      await load()
    })
  }

  const credentialSet = useMemo(
    () => new Set(credentials.map((entry) => `${entry.serverId}:${entry.type}`)),
    [credentials],
  )

  return (
    <section className="settings-section mcp-settings">
      <h2>Remote MCP servers</h2>
      <p className="settings-hint">
        Streamable HTTP is preferred, with legacy SSE fallback in Auto mode. Remote URLs require
        HTTPS; localhost may use HTTP. Secret values are encrypted locally and never synced.
      </p>
      {error ? <p className="settings-error">{error}</p> : null}

      <div className="settings-provider mcp-add">
        <div className="settings-provider-name">Add direct remote URL</div>
        <div className="mcp-grid">
          <input
            className="settings-input"
            aria-label="MCP server id"
            placeholder="server-id"
            value={newServer.id}
            onChange={(event) =>
              setNewServer((current) => ({ ...current, id: event.target.value }))
            }
          />
          <input
            className="settings-input"
            aria-label="MCP server name"
            placeholder="Display name"
            value={newServer.name}
            onChange={(event) =>
              setNewServer((current) => ({ ...current, name: event.target.value }))
            }
          />
          <input
            className="settings-input mcp-url"
            type="url"
            aria-label="MCP server URL"
            placeholder="https://example.com/mcp"
            value={newServer.url}
            onChange={(event) =>
              setNewServer((current) => ({ ...current, url: event.target.value }))
            }
          />
          <select
            className="settings-select"
            aria-label="MCP transport"
            value={newServer.transport}
            onChange={(event) =>
              setNewServer((current) => ({
                ...current,
                transport: event.target.value as McpServerConfigType['transport'],
              }))
            }
          >
            <option value="auto">Auto</option>
            <option value="streamable-http">Streamable HTTP</option>
            <option value="sse">Legacy SSE</option>
          </select>
          <select
            className="settings-select"
            aria-label="MCP authentication"
            value={newServer.authMode}
            onChange={(event) =>
              setNewServer((current) => ({
                ...current,
                authMode: event.target.value as McpServerConfigType['auth']['mode'],
              }))
            }
          >
            <option value="none">No auth</option>
            <option value="oauth">OAuth 2.1</option>
            <option value="bearer">Bearer token</option>
            <option value="api-key">API header</option>
          </select>
        </div>
        <button
          type="button"
          className="settings-btn settings-btn-primary"
          disabled={!newServer.id.trim() || !newServer.url.trim() || busy === 'create'}
          onClick={() => void createServer()}
        >
          {busy === 'create' ? 'Adding…' : 'Add server'}
        </button>
      </div>

      {Object.entries(servers).map(([id, server]) => {
        const draft = drafts[id] ?? toDraft(server)
        const discovery = discoveries[id]
        const query = (toolSearch[id] ?? '').trim().toLowerCase()
        const visibleTools =
          discovery?.tools.filter(
            (item) =>
              !query ||
              item.name.toLowerCase().includes(query) ||
              item.description?.toLowerCase().includes(query),
          ) ?? []
        const serverHealth = health[id]
        const hasManual = credentialSet.has(`${id}:api`)
        const hasOAuth = credentialSet.has(`${id}:oauth`)
        return (
          <div className="settings-provider mcp-server" key={id}>
            <div className="settings-provider-header">
              <div>
                <span className="settings-provider-name">{server.name ?? id}</span>
                <span className="mcp-id">{id}</span>
              </div>
              <div className="settings-provider-badges">
                <label className="settings-enable">
                  <input
                    type="checkbox"
                    checked={server.enabled}
                    onChange={(event) => void patchServer(id, { enabled: event.target.checked })}
                  />
                  Enabled
                </label>
                <span className={`settings-badge ${serverHealth?.ok ? 'settings-badge-ok' : ''}`}>
                  {serverHealth
                    ? serverHealth.ok
                      ? `Connected · ${serverHealth.transport}`
                      : (serverHealth.error?.code ?? 'Error')
                    : discovery
                      ? `Cached · ${discovery.transport}`
                      : 'Not tested'}
                </span>
              </div>
            </div>

            {serverHealth?.error ? (
              <div className="settings-status settings-status-err">
                {serverHealth.error.message}
              </div>
            ) : null}

            <div className="mcp-grid">
              <input
                className="settings-input"
                aria-label={`${id} name`}
                value={draft.name}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [id]: { ...draft, name: event.target.value },
                  }))
                }
              />
              <input
                className="settings-input mcp-url"
                type="url"
                aria-label={`${id} URL`}
                value={draft.url}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [id]: { ...draft, url: event.target.value },
                  }))
                }
              />
              <select
                className="settings-select"
                value={draft.transport}
                aria-label={`${id} transport`}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [id]: {
                      ...draft,
                      transport: event.target.value as ServerDraft['transport'],
                    },
                  }))
                }
              >
                <option value="auto">Auto</option>
                <option value="streamable-http">Streamable HTTP</option>
                <option value="sse">Legacy SSE</option>
              </select>
              <select
                className="settings-select"
                value={draft.authMode}
                aria-label={`${id} authentication`}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [id]: {
                      ...draft,
                      authMode: event.target.value as ServerDraft['authMode'],
                    },
                  }))
                }
              >
                <option value="none">No auth</option>
                <option value="oauth">OAuth 2.1</option>
                <option value="bearer">Bearer token</option>
                <option value="api-key">API header</option>
              </select>
            </div>
            {draft.authMode === 'api-key' ? (
              <input
                className="settings-input"
                aria-label={`${id} API header name`}
                placeholder="X-API-Key"
                value={draft.headerName}
                onChange={(event) =>
                  setDrafts((current) => ({
                    ...current,
                    [id]: { ...draft, headerName: event.target.value },
                  }))
                }
              />
            ) : null}
            <textarea
              className="settings-input mcp-headers"
              aria-label={`${id} non-secret headers`}
              value={draft.headers}
              onChange={(event) =>
                setDrafts((current) => ({
                  ...current,
                  [id]: { ...draft, headers: event.target.value },
                }))
              }
            />
            <p className="settings-hint">
              Non-secret headers as JSON. Authorization and API-key values must use the credential
              control below.
            </p>
            <div className="settings-row">
              <button className="settings-btn" type="button" onClick={() => void saveServer(id)}>
                Save
              </button>
              <button className="settings-btn" type="button" onClick={() => void testServer(id)}>
                {busy === `test:${id}` ? 'Testing…' : 'Test'}
              </button>
              <button
                className="settings-btn"
                type="button"
                onClick={() => void discoverServer(id)}
              >
                {busy === `discover:${id}` ? 'Discovering…' : 'Discover'}
              </button>
              <button
                className="settings-btn settings-btn-danger"
                type="button"
                onClick={() => void removeServer(id)}
              >
                Remove
              </button>
            </div>

            {server.auth.mode === 'oauth' ? (
              <div className="settings-oauth">
                <div className="settings-oauth-title">MCP OAuth 2.1</div>
                <p className="settings-hint">
                  Uses protected-resource and authorization-server discovery, PKCE, resource
                  indicators, and encrypted refresh-token storage.
                </p>
                <button
                  className={`settings-btn ${hasOAuth ? 'settings-btn-danger' : 'settings-btn-primary'}`}
                  type="button"
                  onClick={() => void (hasOAuth ? disconnectOAuth(id) : connectOAuth(id))}
                >
                  {busy === `oauth:${id}`
                    ? 'Working…'
                    : hasOAuth
                      ? 'Disconnect OAuth'
                      : 'Connect OAuth'}
                </button>
              </div>
            ) : server.auth.mode === 'bearer' || server.auth.mode === 'api-key' ? (
              <div className="settings-oauth">
                <div className="settings-oauth-title">
                  {server.auth.mode === 'bearer' ? 'Bearer token' : 'Secret API header'}
                </div>
                <input
                  className="settings-input"
                  type="password"
                  autoComplete="off"
                  placeholder={hasManual ? 'Enter a replacement secret' : 'Secret value'}
                  value={tokens[id] ?? ''}
                  onChange={(event) =>
                    setTokens((current) => ({ ...current, [id]: event.target.value }))
                  }
                />
                <div className="settings-row">
                  <button
                    className="settings-btn settings-btn-primary"
                    type="button"
                    disabled={!tokens[id]?.trim()}
                    onClick={() => void saveCredential(id)}
                  >
                    {hasManual ? 'Replace credential' : 'Save credential'}
                  </button>
                  {hasManual ? (
                    <button
                      className="settings-btn settings-btn-danger"
                      type="button"
                      onClick={() => void deleteCredential(id)}
                    >
                      Remove credential
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}

            {discovery ? (
              <div className="settings-models">
                <div className="mcp-counts">
                  <span>{discovery.tools.length} tools</span>
                  <span>{discovery.resources.length} resources</span>
                  <span>{discovery.prompts.length} prompts</span>
                  <span>{discovery.serverVersion?.version ?? discovery.protocolVersion}</span>
                </div>
                <input
                  className="settings-input"
                  type="search"
                  placeholder="Search discovered tools"
                  value={toolSearch[id] ?? ''}
                  onChange={(event) =>
                    setToolSearch((current) => ({ ...current, [id]: event.target.value }))
                  }
                />
                <div className="settings-row">
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={() => void setAllTools(id, true)}
                  >
                    Enable all
                  </button>
                  <button
                    className="settings-btn"
                    type="button"
                    onClick={() => void setAllTools(id, false)}
                  >
                    Enable none
                  </button>
                </div>
                <div className="settings-model-list">
                  {visibleTools.map((remoteTool) => (
                    <label className="settings-model-row" key={remoteTool.name}>
                      <input
                        type="checkbox"
                        checked={server.tools[remoteTool.name]?.enabled !== false}
                        onChange={(event) =>
                          void setToolEnabled(id, remoteTool.name, event.target.checked)
                        }
                      />
                      <span>
                        <strong>{remoteTool.title ?? remoteTool.name}</strong>
                        {remoteTool.description ? ` — ${remoteTool.description}` : ''}
                        {remoteTool.annotations?.readOnlyHint ? ' · read-only' : ''}
                        {remoteTool.annotations?.destructiveHint ? ' · destructive' : ''}
                        {remoteTool.annotations?.openWorldHint ? ' · open-world' : ''}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        )
      })}

      <div className="settings-provider mcp-marketplace">
        <div className="settings-provider-name">MCP connector marketplace</div>
        <p className="settings-hint">
          The Official MCP Registry is canonical. Direct URLs above always work; Smithery, Glama,
          and custom catalogs are optional provenance or gateway sources.
        </p>
        <div className="settings-row mcp-market-search">
          <input
            className="settings-input"
            type="search"
            placeholder="Search Official MCP Registry"
            value={marketQuery}
            onChange={(event) => setMarketQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void searchMarketplace()
            }}
          />
          <button className="settings-btn" type="button" onClick={() => void searchMarketplace()}>
            {busy === 'marketplace' ? 'Searching…' : 'Search'}
          </button>
        </div>
        <div className="mcp-market-results">
          {marketResults.map((connector) => (
            <div className="mcp-market-item" key={`${connector.id}@${connector.version}`}>
              <div>
                <strong>{connector.name}</strong>
                <p className="settings-hint">{connector.description}</p>
                <code>{connector.url}</code>
              </div>
              <button
                className="settings-btn settings-btn-primary"
                type="button"
                disabled={Boolean(servers[connector.id])}
                onClick={() => void importConnector(connector)}
              >
                {servers[connector.id] ? 'Imported' : 'Import'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
