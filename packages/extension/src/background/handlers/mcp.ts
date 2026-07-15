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

export interface McpHandlerDeps {
  config: ConfigService
  vault: CredentialVault
  registry: RemoteMcpRegistry
  marketplace: McpMarketplaceService
}

function oauthRedirectUrl(): string {
  return chrome.identity.getRedirectURL('mcp')
}

async function launchIdentityFlow(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (callbackUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(`MCP OAuth failed: ${chrome.runtime.lastError.message}`))
        return
      }
      if (!callbackUrl) {
        reject(new Error('MCP OAuth was cancelled before the server returned a callback'))
        return
      }
      resolve(callbackUrl)
    })
  })
}

export function registerMcpHandlers(bus: MessageBus, deps: McpHandlerDeps): void {
  bus
    .on('mcp.server.list', async (message) => {
      const config = await deps.config.get()
      const [discoveries, credentials] = await Promise.all([
        deps.registry.listCachedDiscoveries(),
        deps.vault.listMcp(),
      ])
      return createResponse(message, 'mcp.server.list', {
        servers: config.mcp,
        discoveries,
        credentials,
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
      const pending = await deps.registry.beginOAuth(id, redirectUrl)
      const callbackUrl = await launchIdentityFlow(pending.authorizationUrl)
      const health = await deps.registry.completeOAuth(id, callbackUrl, redirectUrl)
      return createResponse(message, 'mcp.oauth.connect', { ok: health.ok, health })
    })
    .on('mcp.oauth.complete', async (message) => {
      const { id, callbackUrl } = McpOAuthCompletePayload.parse(message.payload)
      const health = await deps.registry.completeOAuth(id, callbackUrl, oauthRedirectUrl())
      return createResponse(message, 'mcp.oauth.complete', { ok: health.ok, health })
    })
    .on('mcp.oauth.disconnect', async (message) => {
      const { id } = McpServerIdPayload.parse(message.payload)
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
