import {
  McpCredentialSetPayload,
  McpClientError,
  McpMarketplaceImportPayload,
  McpMarketplaceSearchPayload,
  McpOAuthCancelPayload,
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
  type McpHealthError,
  type McpMarketplaceService,
  type RemoteMcpRegistry,
} from '@browser-agent/core'
import type { MessageBus } from '../bus.js'

const MCP_OAUTH_PENDING_KEY = 'browser-agent.mcp-oauth-pending'
const MCP_OAUTH_CONNECT_TIMEOUT_MS = 5 * 60 * 1000
const MCP_OAUTH_SAFE_ERROR: McpHealthError = {
  code: 'auth',
  message: 'MCP OAuth could not be completed.',
  action: 'Restart authorization. Do not paste provider error pages or unregistered callback URLs.',
}

type McpOAuthPending = {
  serverId: string
  redirectUrl: string
  generation: string
  manual: boolean
  tabId?: number
  createdAt: number
}

type McpOAuthPendingMap = Record<string, McpOAuthPending>

const activeMcpOAuthListeners = new Map<
  string,
  { generation: string; cleanup: () => void }
>()
const mcpOAuthOperations = new Map<string, Promise<unknown>>()

export interface McpHandlerDeps {
  config: ConfigService
  vault: CredentialVault
  registry: RemoteMcpRegistry
  marketplace: McpMarketplaceService
}

function oauthRedirectUrl(): string {
  return chrome.identity.getRedirectURL('mcp')
}

async function configuredOAuthRedirectUrl(id: string, config: ConfigService): Promise<string> {
  const server = (await config.get()).mcp[id]
  return server?.auth.oauth?.redirectUrl ?? oauthRedirectUrl()
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
  activeMcpOAuthListeners.get(serverId)?.cleanup()
  const pending = await readMcpOAuthPending()
  delete pending[serverId]
  await writeMcpOAuthPending(pending)
}

async function clearCurrentMcpOAuthPending(
  serverId: string,
  generation?: string,
): Promise<boolean> {
  const active = activeMcpOAuthListeners.get(serverId)
  if (!generation || active?.generation === generation) active?.cleanup()
  const pending = await readMcpOAuthPending()
  if (generation && pending[serverId]?.generation !== generation) return false
  const existed = Boolean(pending[serverId])
  delete pending[serverId]
  await writeMcpOAuthPending(pending)
  return existed
}

async function cancelMcpOAuthPending(
  serverId: string,
  registry: RemoteMcpRegistry,
  generation?: string,
  redirectUrl?: string,
): Promise<boolean> {
  if (generation && !(await clearCurrentMcpOAuthPending(serverId, generation))) return false
  if (!generation) await clearMcpOAuthPending(serverId)
  const cancelled = await registry.cancelOAuth(serverId, redirectUrl, generation).catch(() => false)
  return cancelled !== false
}

function serializeMcpOAuth<T>(serverId: string, operation: () => Promise<T>): Promise<T> {
  const previous = mcpOAuthOperations.get(serverId) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(operation)
  mcpOAuthOperations.set(serverId, current)
  void current.finally(() => {
    if (mcpOAuthOperations.get(serverId) === current) {
      mcpOAuthOperations.delete(serverId)
    }
  }).catch(() => undefined)
  return current
}

function oauthFailure(error: unknown): McpHealthError {
  if (error instanceof McpClientError) {
    return {
      code: error.code,
      message: error.message,
      action: error.action ?? MCP_OAUTH_SAFE_ERROR.action,
    }
  }
  return MCP_OAUTH_SAFE_ERROR
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
  await serializeMcpOAuth(pending.serverId, async () => {
    const current = (await readMcpOAuthPending())[pending.serverId]
    if (!current || current.generation !== pending.generation) return
    try {
      await registry.completeOAuth(
        pending.serverId,
        callbackUrl,
        pending.redirectUrl,
        pending.generation,
      )
      await clearCurrentMcpOAuthPending(pending.serverId, pending.generation)
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
      await cancelMcpOAuthPending(
        pending.serverId,
        registry,
        pending.generation,
        pending.redirectUrl,
      )
      console.warn('[browser-agent] MCP OAuth callback exchange failed')
    }
  })
}

function watchMcpOAuthCallback(pending: McpOAuthPending, registry: RemoteMcpRegistry): void {
  if (pending.tabId == null || !hasMcpOAuthBrowserApis()) return
  activeMcpOAuthListeners.get(pending.serverId)?.cleanup()

  const timer = setTimeout(() => {
    void serializeMcpOAuth(pending.serverId, () =>
      cancelMcpOAuthPending(
        pending.serverId,
        registry,
        pending.generation,
        pending.redirectUrl,
      ),
    )
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
    void serializeMcpOAuth(pending.serverId, () =>
      cancelMcpOAuthPending(
        pending.serverId,
        registry,
        pending.generation,
        pending.redirectUrl,
      ),
    )
  }

  function cleanup() {
    clearTimeout(timer)
    chrome.tabs.onUpdated.removeListener(onUpdated)
    chrome.tabs.onRemoved.removeListener(onRemoved)
    if (activeMcpOAuthListeners.get(pending.serverId)?.generation === pending.generation) {
      activeMcpOAuthListeners.delete(pending.serverId)
    }
  }

  activeMcpOAuthListeners.set(pending.serverId, { generation: pending.generation, cleanup })
  chrome.tabs.onUpdated.addListener(onUpdated)
  chrome.tabs.onRemoved.addListener(onRemoved)
}

async function restoreMcpOAuthCallbacks(registry: RemoteMcpRegistry): Promise<void> {
  const pendingMap = await readMcpOAuthPending()
  await Promise.all(
    Object.values(pendingMap).map(async (pending) => {
      if (
        !pending.generation ||
        Date.now() - pending.createdAt > MCP_OAUTH_CONNECT_TIMEOUT_MS
      ) {
        await serializeMcpOAuth(pending.serverId, () =>
          cancelMcpOAuthPending(
            pending.serverId,
            registry,
            pending.generation || undefined,
            pending.redirectUrl,
          ),
        )
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
        oauthPending: Object.values(oauthPending).map(
          ({ serverId, createdAt, generation, manual }) => ({
          serverId,
          createdAt,
            generation,
            manual,
          }),
        ),
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
      await serializeMcpOAuth(id, () => cancelMcpOAuthPending(id, deps.registry))
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
      const started = await serializeMcpOAuth(id, async () => {
        try {
          await cancelMcpOAuthPending(id, deps.registry)
          const attempt = await deps.registry.beginOAuth(
            id,
            await configuredOAuthRedirectUrl(id, deps.config),
          )
          const pending: McpOAuthPending = {
            serverId: id,
            redirectUrl: attempt.redirectUrl,
            generation: attempt.generation,
            manual: false,
            createdAt: Date.now(),
          }
          const pendingMap = await readMcpOAuthPending()
          pendingMap[id] = pending
          await writeMcpOAuthPending(pendingMap)
          return { pending, attempt }
        } catch (error) {
          await cancelMcpOAuthPending(id, deps.registry)
          return { error: oauthFailure(error) }
        }
      })
      if ('error' in started) {
        return createResponse(message, 'mcp.oauth.connect', { ok: false, error: started.error })
      }

      let callbackUrl: string | null
      let captureFailed = false
      try {
        callbackUrl = await tryIdentityFlow(started.attempt.authorizationUrl, started.pending.redirectUrl)
      } catch {
        // The provider already issued an authorization URL. A tab watcher can
        // capture a redirect that was validly registered but not captured by
        // chrome.identity.
        captureFailed = true
        callbackUrl = null
      }
      if (callbackUrl) {
        const completed = await serializeMcpOAuth(id, async () => {
          const current = (await readMcpOAuthPending())[id]
          if (!current || current.generation !== started.pending.generation) {
            return {
              ok: false,
              error: {
                code: 'auth' as const,
                message: 'This OAuth attempt is no longer current.',
                action: 'Use the newest authorization attempt instead.',
              },
            }
          }
          try {
            const health = await deps.registry.completeOAuth(
              id,
              callbackUrl!,
              current.redirectUrl,
              current.generation,
            )
            await clearCurrentMcpOAuthPending(id, current.generation)
            return { ok: health.ok, health }
          } catch (error) {
            await cancelMcpOAuthPending(id, deps.registry, current.generation, current.redirectUrl)
            return { ok: false, error: oauthFailure(error) }
          }
        })
        return createResponse(message, 'mcp.oauth.connect', completed)
      }

      if (!started.attempt.usesConfiguredClient && !captureFailed) {
        const error: McpHealthError = {
          code: 'oauth-redirect',
          message: 'Chrome could not capture this provider’s OAuth callback.',
          action:
            'Use the provider’s supported token auth (GitHub: a fine-grained PAT saved as Bearer), or configure a provider-registered public OAuth client ID and HTTPS/localhost redirect URI. Pasting a rejected Chrome callback cannot bypass provider registration.',
        }
        await serializeMcpOAuth(id, () =>
          cancelMcpOAuthPending(
            id,
            deps.registry,
            started.pending.generation,
            started.pending.redirectUrl,
          ),
        )
        return createResponse(message, 'mcp.oauth.connect', { ok: false, error })
      }

      const fallback = await serializeMcpOAuth(id, async () => {
        const current = (await readMcpOAuthPending())[id]
        if (!current || current.generation !== started.pending.generation) {
          return {
            ok: false,
            error: {
              code: 'auth' as const,
              message: 'This OAuth attempt is no longer current.',
              action: 'Use the newest authorization attempt instead.',
            },
          }
        }
        if (!hasMcpOAuthBrowserApis()) {
          await cancelMcpOAuthPending(id, deps.registry, current.generation, current.redirectUrl)
          return { ok: false, error: MCP_OAUTH_SAFE_ERROR }
        }
        try {
          const tab = await chrome.tabs.create({
            url: started.attempt.authorizationUrl,
            active: true,
          })
          const pending = { ...current, tabId: tab.id, manual: true }
          const pendingMap = await readMcpOAuthPending()
          if (pendingMap[id]?.generation !== pending.generation) {
            return {
              ok: false,
              error: {
                code: 'auth' as const,
                message: 'This OAuth attempt is no longer current.',
                action: 'Use the newest authorization attempt instead.',
              },
            }
          }
          pendingMap[id] = pending
          await writeMcpOAuthPending(pendingMap)
          watchMcpOAuthCallback(pending, deps.registry)
          return { ok: true, pending: true, manual: true, generation: pending.generation }
        } catch (error) {
          await cancelMcpOAuthPending(id, deps.registry, current.generation, current.redirectUrl)
          return { ok: false, error: oauthFailure(error) }
        }
      })
      return createResponse(message, 'mcp.oauth.connect', fallback)
    })
    .on('mcp.oauth.complete', async (message) => {
      const { id, callbackUrl, generation } = McpOAuthCompletePayload.parse(message.payload)
      const completed = await serializeMcpOAuth(id, async () => {
        const pending = (await readMcpOAuthPending())[id]
        if (!pending || pending.generation !== generation) {
          return {
            ok: false,
            error: {
              code: 'auth' as const,
              message: 'This OAuth attempt is no longer current.',
              action: 'Use the newest authorization attempt instead.',
            },
          }
        }
        try {
          const health = await deps.registry.completeOAuth(
            id,
            callbackUrl,
            pending.redirectUrl,
            generation,
          )
          await clearCurrentMcpOAuthPending(id, generation)
          return { ok: health.ok, health }
        } catch (error) {
          await cancelMcpOAuthPending(id, deps.registry, generation, pending.redirectUrl)
          return { ok: false, error: oauthFailure(error) }
        }
      })
      return createResponse(message, 'mcp.oauth.complete', completed)
    })
    .on('mcp.oauth.cancel', async (message) => {
      const { id, generation } = McpOAuthCancelPayload.parse(message.payload)
      const cancelled = await serializeMcpOAuth(id, async () => {
        const pending = (await readMcpOAuthPending())[id]
        if (!pending || pending.generation !== generation) {
          return {
            ok: false,
            error: {
              code: 'auth' as const,
              message: 'This OAuth attempt is no longer current.',
              action: 'Use the newest authorization attempt instead.',
            },
          }
        }
        await cancelMcpOAuthPending(id, deps.registry, generation, pending.redirectUrl)
        return { ok: true, id }
      })
      return createResponse(message, 'mcp.oauth.cancel', cancelled)
    })
    .on('mcp.oauth.disconnect', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
      await serializeMcpOAuth(id, async () => {
        await cancelMcpOAuthPending(id, deps.registry)
        await deps.registry.disconnectOAuth(id)
      })
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
