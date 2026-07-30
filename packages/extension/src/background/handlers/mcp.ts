import {
  McpCredentialSetPayload,
  McpMarketplaceImportPayload,
  McpMarketplaceSearchPayload,
  McpOAuthCompletePayload,
  McpResourceReadPayload,
  McpServerCreatePayload,
  McpServerIdPayload,
  McpServerUpdatePayload,
  connectorManifestToConfig,
  createResponse,
  type ConfigService,
  type CredentialVault,
  type Envelope,
  type McpMarketplaceService,
  type RemoteMcpRegistry,
} from '@browser-agent/core'
import type { MessageBus } from '../bus.js'

const MCP_OAUTH_PENDING_KEY = 'browser-agent.mcp-oauth-pending'
const MCP_OAUTH_CONNECT_TIMEOUT_MS = 5 * 60 * 1000
const MCP_OAUTH_SAFE_ERROR =
  'MCP OAuth could not be completed. Restart Connect and complete the callback before it expires.'

type McpOAuthPending = {
  serverId: string
  redirectUrl: string
  tabId?: number
  createdAt: number
}

type McpOAuthPendingMap = Record<string, McpOAuthPending>

const activeMcpOAuthListeners = new Map<string, () => void>()

export interface McpHandlerDeps {
  config: ConfigService
  vault: CredentialVault
  registry: RemoteMcpRegistry
  marketplace: McpMarketplaceService
}

function oauthRedirectUrl(): string {
  return chrome.identity.getRedirectURL('mcp')
}

function hasMcpOAuthBrowserApis(): boolean {
  return (
    typeof chrome !== 'undefined' &&
    Boolean(chrome.storage?.session) &&
    Boolean(chrome.tabs) &&
    Boolean(chrome.identity)
  )
}

async function readMcpOAuthPending(): Promise<McpOAuthPendingMap> {
  if (!hasMcpOAuthBrowserApis()) return {}
  const result = await chrome.storage.session.get(MCP_OAUTH_PENDING_KEY)
  const value = result[MCP_OAUTH_PENDING_KEY]
  return value && typeof value === 'object' ? (value as McpOAuthPendingMap) : {}
}

async function writeMcpOAuthPending(pending: McpOAuthPendingMap): Promise<void> {
  if (!hasMcpOAuthBrowserApis()) return
  await chrome.storage.session.set({ [MCP_OAUTH_PENDING_KEY]: pending })
}

async function clearMcpOAuthPending(serverId: string): Promise<void> {
  activeMcpOAuthListeners.get(serverId)?.()
  activeMcpOAuthListeners.delete(serverId)
  const pending = await readMcpOAuthPending()
  delete pending[serverId]
  await writeMcpOAuthPending(pending)
}

async function cancelMcpOAuthPending(serverId: string, registry: RemoteMcpRegistry): Promise<void> {
  await Promise.all([
    clearMcpOAuthPending(serverId),
    registry.cancelOAuth(serverId).catch(() => {
      // The pending record is still consumed when a server was removed or is unavailable.
    }),
  ])
}

function safeMcpOAuthError(): Error {
  return new Error(MCP_OAUTH_SAFE_ERROR)
}

function isMcpOAuthCallback(callbackUrl: string, redirectUrl: string): boolean {
  try {
    const callback = new URL(callbackUrl)
    const expected = new URL(redirectUrl)
    return callback.origin === expected.origin && callback.pathname === expected.pathname
  } catch {
    return false
  }
}

async function completeMcpOAuthCallback(
  pending: McpOAuthPending,
  callbackUrl: string,
  registry: RemoteMcpRegistry,
): Promise<void> {
  try {
    await registry.completeOAuth(pending.serverId, callbackUrl, pending.redirectUrl)
    await clearMcpOAuthPending(pending.serverId)
    if (pending.tabId != null) {
      try {
        await chrome.tabs.remove(pending.tabId)
      } catch {
        // The authorization tab may already be closed.
      }
    }
  } catch {
    // The callback URL can contain an authorization code, so do not log it or
    // the thrown error. A fresh Connect attempt can safely restart the flow.
    await cancelMcpOAuthPending(pending.serverId, registry)
    console.warn('[browser-agent] MCP OAuth callback exchange failed')
  }
}

function watchMcpOAuthCallback(pending: McpOAuthPending, registry: RemoteMcpRegistry): void {
  if (pending.tabId == null || !hasMcpOAuthBrowserApis()) return
  activeMcpOAuthListeners.get(pending.serverId)?.()

  const timer = setTimeout(() => {
    void cancelMcpOAuthPending(pending.serverId, registry)
  }, MCP_OAUTH_CONNECT_TIMEOUT_MS)

  const onUpdated = (
    updatedTabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => {
    if (updatedTabId !== pending.tabId) return
    const callbackUrl = changeInfo.url ?? tab.url
    if (!callbackUrl || !isMcpOAuthCallback(callbackUrl, pending.redirectUrl)) return
    cleanup()
    void completeMcpOAuthCallback(pending, callbackUrl, registry)
  }

  const onRemoved = (tabId: number) => {
    if (tabId !== pending.tabId) return
    void cancelMcpOAuthPending(pending.serverId, registry)
  }

  function cleanup() {
    clearTimeout(timer)
    chrome.tabs.onUpdated.removeListener(onUpdated)
    chrome.tabs.onRemoved.removeListener(onRemoved)
    activeMcpOAuthListeners.delete(pending.serverId)
  }

  activeMcpOAuthListeners.set(pending.serverId, cleanup)
  chrome.tabs.onUpdated.addListener(onUpdated)
  chrome.tabs.onRemoved.addListener(onRemoved)
}

async function restoreMcpOAuthCallbacks(registry: RemoteMcpRegistry): Promise<void> {
  const pendingMap = await readMcpOAuthPending()
  await Promise.all(
    Object.values(pendingMap).map(async (pending) => {
      if (Date.now() - pending.createdAt > MCP_OAUTH_CONNECT_TIMEOUT_MS) {
        await cancelMcpOAuthPending(pending.serverId, registry)
        return
      }
      watchMcpOAuthCallback(pending, registry)
    }),
  )
}

/**
 * chrome.identity owns the normal callback. A tab watcher is retained as a
 * fallback for providers or browsers that reject an identity flow, mirroring
 * the provider OAuth handler's fallback without putting callback data in UI
 * state or synced storage.
 */
async function tryIdentityFlow(url: string, redirectUrl: string): Promise<string | null> {
  if (
    !hasMcpOAuthBrowserApis() ||
    typeof chrome.identity.launchWebAuthFlow !== 'function' ||
    !redirectUrl.includes('chromiumapp.org')
  ) {
    return null
  }

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (callbackUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!callbackUrl) {
        resolve(null)
      } else {
        resolve(callbackUrl)
      }
    })
  })
}

export function registerMcpHandlers(bus: MessageBus, deps: McpHandlerDeps): void {
  void restoreMcpOAuthCallbacks(deps.registry)

  bus
    .on('mcp.server.list', async (message) => {
      const config = await deps.config.get()
      const [discoveries, credentials, oauthPending] = await Promise.all([
        deps.registry.listCachedDiscoveries(),
        deps.vault.listMcp(),
        readMcpOAuthPending(),
      ])
      return createResponse(message, 'mcp.server.list', {
        servers: config.mcp,
        discoveries,
        credentials,
        oauthPending: Object.values(oauthPending).map(({ serverId, createdAt }) => ({
          serverId,
          createdAt,
        })),
      })
    })
    .on('mcp.server.create', async (message) => {
      const payload = McpServerCreatePayload.parse(message.payload)
      const current = await deps.config.get()
      if (current.mcp[payload.id]) throw new Error(`MCP server "${payload.id}" already exists`)
      const config = await deps.config.set({ mcp: { [payload.id]: payload.server } })
      return createResponse(message, 'mcp.server.create', {
        id: payload.id,
        server: config.mcp[payload.id],
      })
    })
    .on('mcp.server.update', async (message) => {
      const payload = McpServerUpdatePayload.parse(message.payload)
      const current = await deps.config.get()
      if (!current.mcp[payload.id]) throw new Error(`Unknown MCP server "${payload.id}"`)
      await deps.registry.close(payload.id)
      const config = await deps.config.set({ mcp: { [payload.id]: payload.patch } })
      return createResponse(message, 'mcp.server.update', {
        id: payload.id,
        server: config.mcp[payload.id],
      })
    })
    .on('mcp.server.delete', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      await cancelMcpOAuthPending(id, deps.registry)
      await Promise.all([
        deps.registry.close(id),
        deps.registry.clearCachedDiscovery(id),
        deps.vault.deleteMcp(id),
      ])
      await deps.config.set({ mcp: { [id]: null } })
      return createResponse(message, 'mcp.server.delete', { ok: true, id })
    })
    .on('mcp.server.test', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      return createResponse(message, 'mcp.server.test', await deps.registry.testConnection(id))
    })
    .on('mcp.server.discover', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      const discovery = await deps.registry.discover(id)
      const current = await deps.config.get()
      const server = current.mcp[id]
      if (!server) throw new Error(`Unknown MCP server "${id}"`)
      const tools = Object.fromEntries(
        discovery.tools.map((tool) => [
          tool.name,
          { enabled: server.tools[tool.name]?.enabled ?? true },
        ]),
      )
      await deps.config.set({ mcp: { [id]: { tools } } })
      return createResponse(message, 'mcp.server.discover', discovery)
    })
    .on('mcp.credential.set', async (message) => {
      const { id, secret } = McpCredentialSetPayload.parse(message.payload)
      const server = (await deps.config.get()).mcp[id]
      if (!server) throw new Error(`Unknown MCP server "${id}"`)
      if (server.auth.mode !== 'bearer' && server.auth.mode !== 'api-key') {
        throw new Error('Set MCP auth mode to bearer or API key before saving a manual credential')
      }
      await deps.vault.setMcp(id, secret, 'api')
      await deps.registry.close(id)
      return createResponse(message, 'mcp.credential.set', {
        ok: true,
        credentials: await deps.vault.listMcp(),
      })
    })
    .on('mcp.credential.delete', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      await deps.vault.deleteMcp(id, 'api')
      await deps.registry.close(id)
      return createResponse(message, 'mcp.credential.delete', {
        ok: true,
        credentials: await deps.vault.listMcp(),
      })
    })
    .on('mcp.oauth.connect', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      const redirectUrl = oauthRedirectUrl()
      let pending: { authorizationUrl: string; state: string }
      try {
        pending = await deps.registry.beginOAuth(id, redirectUrl)
      } catch {
        await cancelMcpOAuthPending(id, deps.registry)
        throw safeMcpOAuthError()
      }
      let callbackUrl: string | null
      try {
        callbackUrl = await tryIdentityFlow(pending.authorizationUrl, redirectUrl)
      } catch {
        // Fall through to the tab callback watcher. This is intentionally the
        // same resilient path used by provider OAuth for fixed redirects.
        callbackUrl = null
      }
      if (callbackUrl) {
        try {
          const health = await deps.registry.completeOAuth(id, callbackUrl, redirectUrl)
          await clearMcpOAuthPending(id)
          return createResponse(message, 'mcp.oauth.connect', { ok: health.ok, health })
        } catch {
          await cancelMcpOAuthPending(id, deps.registry)
          throw safeMcpOAuthError()
        }
      }

      if (!hasMcpOAuthBrowserApis()) {
        await cancelMcpOAuthPending(id, deps.registry)
        throw safeMcpOAuthError()
      }
      let tab: chrome.tabs.Tab
      try {
        tab = await chrome.tabs.create({ url: pending.authorizationUrl, active: true })
      } catch {
        await cancelMcpOAuthPending(id, deps.registry)
        throw safeMcpOAuthError()
      }
      const fallbackPending: McpOAuthPending = {
        serverId: id,
        redirectUrl,
        tabId: tab.id,
        createdAt: Date.now(),
      }
      const pendingMap = await readMcpOAuthPending()
      pendingMap[id] = fallbackPending
      await writeMcpOAuthPending(pendingMap)
      watchMcpOAuthCallback(fallbackPending, deps.registry)
      return createResponse(message, 'mcp.oauth.connect', {
        ok: true,
        pending: true,
        manual: true,
      })
    })
    .on('mcp.oauth.complete', async (message) => {
      const { id, callbackUrl } = McpOAuthCompletePayload.parse(message.payload)
      try {
        const health = await deps.registry.completeOAuth(id, callbackUrl, oauthRedirectUrl())
        await clearMcpOAuthPending(id)
        return createResponse(message, 'mcp.oauth.complete', { ok: health.ok, health })
      } catch {
        await cancelMcpOAuthPending(id, deps.registry)
        throw safeMcpOAuthError()
      }
    })
    .on('mcp.oauth.cancel', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      await cancelMcpOAuthPending(id, deps.registry)
      return createResponse(message, 'mcp.oauth.cancel', { ok: true, id })
    })
    .on('mcp.oauth.disconnect', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      await cancelMcpOAuthPending(id, deps.registry)
      await deps.registry.disconnectOAuth(id)
      return createResponse(message, 'mcp.oauth.disconnect', { ok: true, id })
    })
    .on('mcp.resources.list', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      return createResponse(message, 'mcp.resources.list', {
        resources: await deps.registry.listResources(id),
      })
    })
    .on('mcp.resources.read', async (message) => {
      const { id, uri } = McpResourceReadPayload.parse(message.payload)
      return createResponse(message, 'mcp.resources.read', {
        result: await deps.registry.readResource(id, uri),
      })
    })
    .on('mcp.marketplace.search', async (message) => {
      const payload = McpMarketplaceSearchPayload.parse(message.payload ?? {})
      const connectors = await deps.marketplace.search(payload.query, payload)
      return createResponse(message, 'mcp.marketplace.search', { connectors })
    })
    .on('mcp.marketplace.import', async (message) => {
      const payload = McpMarketplaceImportPayload.parse(message.payload)
      const converted = connectorManifestToConfig(payload.manifest)
      const id = payload.id ?? converted.id
      const current = await deps.config.get()
      if (current.mcp[id]) throw new Error(`MCP server "${id}" already exists`)
      const config = await deps.config.set({ mcp: { [id]: converted.config } })
      return createResponse(message, 'mcp.marketplace.import', {
        id,
        server: config.mcp[id],
      })
    })
}

/** @internal test helper */
export async function dispatchMcpMessage(bus: MessageBus, message: Envelope): Promise<Envelope> {
  return bus.dispatch(message, {} as chrome.runtime.MessageSender)
}
