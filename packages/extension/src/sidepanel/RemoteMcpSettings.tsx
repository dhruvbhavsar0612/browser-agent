import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  McpDiscovery,
  McpHealth,
  McpMarketplaceConnector,
  McpServerConfigType,
  McpServerPreset,
  McpVaultListEntry,
} from '@browser-agent/core'
import { searchMcpPresets } from '@browser-agent/core'
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

type CreateForm = {
  id: string
  name: string
  url: string
  transport: McpServerConfigType['transport']
  authMode: McpServerConfigType['auth']['mode']
  preset: McpServerPreset | null
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

const CATEGORY_LABELS: Record<string, string> = {
  'web-search': 'Web',
  docs: 'Docs',
  devtools: 'Dev Tools',
  project: 'Projects',
  other: 'Other',
}

const AUTH_LABELS: Record<string, string> = {
  oauth: 'OAuth 2.1',
  bearer: 'Bearer',
  'api-key': 'API key',
}

export function RemoteMcpSettings() {
  const [servers, setServers] = useState<ServerMap>({})
  const [discoveries, setDiscoveries] = useState<Record<string, McpDiscovery>>({})
  const [credentials, setCredentials] = useState<McpVaultListEntry[]>([])
  const [drafts, setDrafts] = useState<Record<string, ServerDraft>>({})
  const [tokens, setTokens] = useState<Record<string, string>>({})
  const [toolSearch, setToolSearch] = useState<Record<string, string>>({})
  const [health, setHealth] = useState<Record<string, McpHealth>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const [globalSearch, setGlobalSearch] = useState('')
  const [createForm, setCreateForm] = useState<CreateForm | null>(null)
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set())

  const [marketResults, setMarketResults] = useState<McpMarketplaceConnector[]>([])
  const [marketLoading, setMarketLoading] = useState(false)

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

  // Auto-search marketplace with debounce
  useEffect(() => {
    const q = globalSearch.trim()
    if (!q) {
      setMarketResults([])
      return
    }

    let cancelled = false
    const timer = setTimeout(async () => {
      setMarketLoading(true)
      try {
        const response = await sendRequest('mcp.marketplace.search', {
          query: q,
          source: 'official',
          limit: 30,
        })
        if (cancelled) return
        if (response.type !== 'error') {
          setMarketResults(
            (response.payload as { connectors?: McpMarketplaceConnector[] }).connectors ?? [],
          )
        }
      } catch {
        // ignore transient network errors
      } finally {
        if (!cancelled) setMarketLoading(false)
      }
    }, 500)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [globalSearch])

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

  function openAddForm() {
    setError(null)
    setCreateForm({ id: '', name: '', url: '', transport: 'auto', authMode: 'none', preset: null })
  }

  function openPresetForm(preset: McpServerPreset) {
    setError(null)
    setCreateForm({
      id: preset.id,
      name: preset.name,
      url: preset.url,
      transport: preset.transport ?? 'auto',
      authMode: preset.authMode,
      preset,
    })
  }

  function closeAddForm() {
    setCreateForm(null)
    setError(null)
  }

  function toggleExpand(id: string) {
    setExpandedServers((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function createServer() {
    if (!createForm) return
    const id = createForm.id.trim().toLowerCase()
    await run('create', async () => {
      await request('mcp.server.create', {
        id,
        server: {
          type: 'remote',
          name: createForm.name.trim() || id,
          url: createForm.url.trim(),
          transport: createForm.transport,
          enabled: true,
          headers: {},
          auth: { mode: createForm.authMode },
          tools: {},
        },
      })
      setCreateForm(null)
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

  async function importConnector(connector: McpMarketplaceConnector) {
    await run(`import:${connector.id}`, async () => {
      await request('mcp.marketplace.import', { manifest: connector.manifest })
      await load()
    })
  }

  const filteredServerEntries = useMemo(() => {
    const q = globalSearch.trim().toLowerCase()
    const entries = Object.entries(servers)
    if (!q) return entries
    return entries.filter(
      ([id, server]) =>
        id.includes(q) ||
        (server.name ?? '').toLowerCase().includes(q) ||
        server.url.toLowerCase().includes(q),
    )
  }, [servers, globalSearch])

  const visiblePresets = useMemo(() => searchMcpPresets(globalSearch), [globalSearch])

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

      <div className="mcp-search-row">
        <input
          className="settings-input"
          type="search"
          placeholder="Search installed servers, presets, and registry…"
          value={globalSearch}
          onChange={(event) => setGlobalSearch(event.target.value)}
          aria-label="Search MCP servers"
        />
        <button
          type="button"
          className="settings-btn settings-btn-primary mcp-add-btn"
          onClick={openAddForm}
          disabled={createForm !== null}
        >
          Add server
        </button>
      </div>

      {error ? <p className="settings-error">{error}</p> : null}

      {createForm !== null && (
        <div className="settings-provider mcp-add-panel">
          <div className="settings-provider-header">
            <div className="settings-provider-name">
              {createForm.preset ? `Add ${createForm.preset.name}` : 'Add MCP server'}
            </div>
            <button type="button" className="settings-btn" onClick={closeAddForm}>
              Cancel
            </button>
          </div>

          {createForm.preset?.setupHint ? (
            <p className="settings-hint mcp-setup-hint">{createForm.preset.setupHint}</p>
          ) : null}

          <div className="mcp-grid">
            <input
              className="settings-input"
              aria-label="Server ID"
              placeholder="server-id"
              value={createForm.id}
              onChange={(event) =>
                setCreateForm((form) => form && { ...form, id: event.target.value })
              }
            />
            <input
              className="settings-input"
              aria-label="Display name"
              placeholder="Display name"
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((form) => form && { ...form, name: event.target.value })
              }
            />
            <input
              className="settings-input mcp-url"
              type="url"
              aria-label="Server URL"
              placeholder="https://example.com/mcp"
              value={createForm.url}
              onChange={(event) =>
                setCreateForm((form) => form && { ...form, url: event.target.value })
              }
            />
            <select
              className="settings-select"
              aria-label="Transport"
              value={createForm.transport}
              onChange={(event) =>
                setCreateForm(
                  (form) =>
                    form && {
                      ...form,
                      transport: event.target.value as McpServerConfigType['transport'],
                    },
                )
              }
            >
              <option value="auto">Auto</option>
              <option value="streamable-http">Streamable HTTP</option>
              <option value="sse">Legacy SSE</option>
            </select>
            <select
              className="settings-select"
              aria-label="Authentication"
              value={createForm.authMode}
              onChange={(event) =>
                setCreateForm(
                  (form) =>
                    form && {
                      ...form,
                      authMode: event.target.value as McpServerConfigType['auth']['mode'],
                    },
                )
              }
            >
              <option value="none">No auth</option>
              <option value="oauth">OAuth 2.1</option>
              <option value="bearer">Bearer token</option>
              <option value="api-key">API header</option>
            </select>
          </div>

          <div className="settings-row">
            <button
              type="button"
              className="settings-btn settings-btn-primary"
              disabled={!createForm.id.trim() || !createForm.url.trim() || busy === 'create'}
              onClick={() => void createServer()}
            >
              {busy === 'create' ? 'Adding…' : 'Add server'}
            </button>
            <button type="button" className="settings-btn" onClick={closeAddForm}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {filteredServerEntries.length > 0 && (
        <div className="mcp-list-section">
          <div className="mcp-list-label">
            Installed
            <span className="mcp-count-badge">{filteredServerEntries.length}</span>
          </div>

          {filteredServerEntries.map(([id, server]) => {
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
            const isExpanded = expandedServers.has(id)

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
                        onChange={(event) =>
                          void patchServer(id, { enabled: event.target.checked })
                        }
                      />
                      Enabled
                    </label>
                    <span
                      className={`settings-badge ${serverHealth?.ok ? 'settings-badge-ok' : ''}`}
                    >
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

                <div className="settings-row mcp-server-actions">
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={Boolean(busy)}
                    onClick={() => void testServer(id)}
                  >
                    {busy === `test:${id}` ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    type="button"
                    className="settings-btn"
                    disabled={Boolean(busy)}
                    onClick={() => void discoverServer(id)}
                  >
                    {busy === `discover:${id}` ? 'Discovering…' : 'Discover'}
                  </button>
                  <button
                    type="button"
                    className="settings-btn settings-btn-danger"
                    disabled={Boolean(busy)}
                    onClick={() => void removeServer(id)}
                  >
                    Remove
                  </button>
                  <button
                    type="button"
                    className="settings-btn mcp-expand-btn"
                    aria-expanded={isExpanded}
                    onClick={() => toggleExpand(id)}
                  >
                    {isExpanded ? 'Close ▲' : 'Edit ▼'}
                  </button>
                </div>

                {serverHealth?.error ? (
                  <div className="settings-status settings-status-err">
                    {serverHealth.error.message}
                  </div>
                ) : null}

                {isExpanded && (
                  <>
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
                      Non-secret headers as JSON. Authorization and API-key values must use the
                      credential control below.
                    </p>

                    <div className="settings-row">
                      <button
                        type="button"
                        className="settings-btn settings-btn-primary"
                        disabled={Boolean(busy)}
                        onClick={() => void saveServer(id)}
                      >
                        {busy === `save:${id}` ? 'Saving…' : 'Save changes'}
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
                          onClick={() =>
                            void (hasOAuth ? disconnectOAuth(id) : connectOAuth(id))
                          }
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
                          <span>
                            {discovery.serverVersion?.version ?? discovery.protocolVersion}
                          </span>
                        </div>
                        <input
                          className="settings-input"
                          type="search"
                          placeholder="Search discovered tools"
                          value={toolSearch[id] ?? ''}
                          onChange={(event) =>
                            setToolSearch((current) => ({
                              ...current,
                              [id]: event.target.value,
                            }))
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
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}

      {visiblePresets.length > 0 && (
        <div className="mcp-list-section">
          <div className="mcp-list-label">Presets</div>
          <div className="mcp-presets-grid">
            {visiblePresets.map((preset) => {
              const installed = Boolean(servers[preset.id])
              return (
                <div className="mcp-preset-card" key={preset.id}>
                  <div className="mcp-preset-top">
                    <span className="mcp-preset-name">{preset.name}</span>
                    <span className="mcp-preset-category">
                      {CATEGORY_LABELS[preset.category] ?? preset.category}
                    </span>
                  </div>
                  <p className="settings-hint mcp-preset-desc">{preset.description}</p>
                  <div className="mcp-preset-footer">
                    {preset.authMode !== 'none' && (
                      <span className="mcp-preset-auth">
                        {AUTH_LABELS[preset.authMode] ?? preset.authMode}
                      </span>
                    )}
                    <button
                      type="button"
                      className={`settings-btn mcp-preset-add ${installed ? '' : 'settings-btn-primary'}`}
                      disabled={installed || busy === 'create'}
                      onClick={() => openPresetForm(preset)}
                    >
                      {installed ? '✓ Installed' : 'Add'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {globalSearch.trim() && (marketLoading || marketResults.length > 0) && (
        <div className="mcp-list-section">
          <div className="mcp-list-label">
            Official Registry
            {marketLoading && (
              <span className="mcp-registry-loading">&nbsp;· Searching…</span>
            )}
          </div>
          {marketResults.length > 0 && (
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
          )}
        </div>
      )}
    </section>
  )
}
