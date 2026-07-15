import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport, SseError } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  UnauthorizedError,
  auth,
  type OAuthClientProvider,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { ConfigService } from '../config/service.js'
import { MCP_DISCOVERY_CACHE_KEY, type StorageAdapter } from '../config/storage.js'
import type { McpServerConfig } from '../config/schema.js'
import type { CredentialVault } from '../vault/index.js'
import { McpOAuthClientProvider } from './oauth.js'
import { normalizeMcpToolResult } from './result.js'
import {
  MCP_PROTOCOL_VERSION,
  type McpDiscoveredPrompt,
  type McpDiscoveredResource,
  type McpDiscoveredTool,
  type McpDiscovery,
  type McpHealth,
  type McpHealthErrorCode,
  type McpTransportKind,
  type NormalizedMcpToolResult,
} from './types.js'

type FetchLike = typeof fetch

interface Connection {
  client: Client
  transport: Transport
  kind: McpTransportKind
  fingerprint: string
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface McpConnectionFactoryInput {
  serverId: string
  server: McpServerConfig
  kind: McpTransportKind
  headers: Record<string, string>
  authProvider?: OAuthClientProvider
  fetch: FetchLike
}

export type McpConnectionFactory = (
  input: McpConnectionFactoryInput,
) => Promise<{ client: Client; transport: Transport }>

export interface RemoteMcpRegistryOptions {
  fetch?: FetchLike
  idleMs?: number
  requestTimeoutMs?: number
  now?: () => number
  oauthRedirectUrl?: string | (() => string)
  connectionFactory?: McpConnectionFactory
}

type DiscoveryCache = Record<string, McpDiscovery>

export class McpClientError extends Error {
  constructor(
    message: string,
    readonly code: McpHealthErrorCode,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'McpClientError'
  }
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message
  return typeof error === 'string' ? error : String(error)
}

function classifyError(error: unknown): McpClientError {
  if (error instanceof McpClientError) return error
  const message = formatError(error)
  const lower = message.toLowerCase()
  if (
    error instanceof UnauthorizedError ||
    /\b(?:401|403)\b/.test(message) ||
    lower.includes('unauthorized') ||
    lower.includes('oauth')
  ) {
    return new McpClientError(
      `Authentication required or expired. Connect OAuth or update the server credential. (${message})`,
      'auth',
      error,
    )
  }
  if (lower.includes('cors') || lower.includes('access-control-allow-origin')) {
    return new McpClientError(
      `The MCP server blocked this extension with CORS. Allow the extension origin and MCP request headers. (${message})`,
      'cors',
      error,
    )
  }
  if (error instanceof StreamableHTTPError || error instanceof SseError) {
    return new McpClientError(`Remote MCP transport failed: ${message}`, 'transport', error)
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('dns')
  ) {
    return new McpClientError(
      `Could not reach the MCP server. Check its URL, network access, and CORS policy. (${message})`,
      'network',
      error,
    )
  }
  if (
    lower.includes('json-rpc') ||
    lower.includes('protocol') ||
    lower.includes('initialize') ||
    lower.includes('parse')
  ) {
    return new McpClientError(
      `The endpoint did not complete a compatible MCP ${MCP_PROTOCOL_VERSION} handshake. (${message})`,
      'protocol',
      error,
    )
  }
  return new McpClientError(`Remote MCP server error: ${message}`, 'server', error)
}

function shouldFallBackToSse(error: unknown): boolean {
  if (error instanceof UnauthorizedError) return false
  if (error instanceof StreamableHTTPError) {
    return error.code === undefined || [400, 404, 405, 406, 415].includes(error.code)
  }
  const message = formatError(error).toLowerCase()
  if (message.includes('401') || message.includes('403') || message.includes('oauth')) return false
  return (
    message.includes('404') ||
    message.includes('405') ||
    message.includes('unsupported media') ||
    message.includes('method not allowed') ||
    message.includes('failed to fetch') ||
    message.includes('network')
  )
}

function configFingerprint(server: McpServerConfig): string {
  return JSON.stringify({
    url: server.url,
    transport: server.transport,
    headers: server.headers,
    auth: server.auth,
  })
}

function normalizeTool(tool: {
  name: string
  title?: string
  description?: string
  inputSchema: unknown
  outputSchema?: unknown
  annotations?: unknown
}): McpDiscoveredTool {
  return {
    name: tool.name,
    ...(tool.title ? { title: tool.title } : {}),
    ...(tool.description ? { description: tool.description } : {}),
    inputSchema:
      tool.inputSchema && typeof tool.inputSchema === 'object'
        ? (tool.inputSchema as Record<string, unknown>)
        : { type: 'object' },
    ...(tool.outputSchema && typeof tool.outputSchema === 'object'
      ? { outputSchema: tool.outputSchema as Record<string, unknown> }
      : {}),
    ...(tool.annotations && typeof tool.annotations === 'object'
      ? { annotations: tool.annotations as McpDiscoveredTool['annotations'] }
      : {}),
  }
}

export class RemoteMcpRegistry {
  private readonly connections = new Map<string, Connection>()
  private readonly fetchImpl: FetchLike
  private readonly idleMs: number
  private readonly requestTimeoutMs: number
  private readonly now: () => number

  constructor(
    private readonly config: ConfigService,
    private readonly vault: CredentialVault,
    private readonly storage: StorageAdapter,
    private readonly options: RemoteMcpRegistryOptions = {},
  ) {
    this.fetchImpl = options.fetch ?? fetch
    this.idleMs = options.idleMs ?? 15_000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000
    this.now = options.now ?? Date.now
  }

  async getConfig() {
    return this.config.get()
  }

  async testConnection(serverId: string): Promise<McpHealth> {
    const started = this.now()
    try {
      const connection = await this.getConnection(serverId)
      await connection.client.ping({ timeout: this.requestTimeoutMs })
      const version = connection.client.getServerVersion()
      return {
        ok: true,
        serverId,
        checkedAt: this.now(),
        transport: connection.kind,
        ...(version ? { serverVersion: version } : {}),
        protocolVersion: this.protocolVersion(connection),
        latencyMs: Math.max(0, this.now() - started),
      }
    } catch (error) {
      const healthError = classifyError(error)
      return {
        ok: false,
        serverId,
        checkedAt: this.now(),
        latencyMs: Math.max(0, this.now() - started),
        error: {
          code: healthError.code,
          message: healthError.message,
          detail: formatError(healthError.cause),
        },
      }
    } finally {
      this.scheduleClose(serverId)
    }
  }

  async discover(serverId: string): Promise<McpDiscovery> {
    const server = await this.requireServer(serverId)
    const connection = await this.getConnection(serverId)
    const capabilities = connection.client.getServerCapabilities()
    const warnings: string[] = []

    try {
      const tools = capabilities?.tools
        ? await this.collectPages<McpDiscoveredTool>(async (cursor) => {
            const page = await connection.client.listTools(cursor ? { cursor } : undefined, {
              timeout: this.requestTimeoutMs,
            })
            return {
              items: page.tools.map(normalizeTool),
              nextCursor: page.nextCursor,
            }
          })
        : []

      const resources = capabilities?.resources
        ? await this.collectPages<McpDiscoveredResource>(async (cursor) => {
            const page = await connection.client.listResources(cursor ? { cursor } : undefined, {
              timeout: this.requestTimeoutMs,
            })
            return { items: page.resources, nextCursor: page.nextCursor }
          })
        : []

      const prompts = capabilities?.prompts
        ? await this.collectPages<McpDiscoveredPrompt>(async (cursor) => {
            const page = await connection.client.listPrompts(cursor ? { cursor } : undefined, {
              timeout: this.requestTimeoutMs,
            })
            return { items: page.prompts, nextCursor: page.nextCursor }
          })
        : []

      if (!capabilities?.tools) warnings.push('Server does not advertise tools')
      if (!capabilities?.resources) warnings.push('Server does not advertise resources')
      if (!capabilities?.prompts) warnings.push('Server does not advertise prompts')

      const version = connection.client.getServerVersion()
      const discovery: McpDiscovery = {
        serverId,
        serverName: server.name ?? serverId,
        ...(version ? { serverVersion: version } : {}),
        protocolVersion: this.protocolVersion(connection),
        transport: connection.kind,
        discoveredAt: this.now(),
        tools,
        resources,
        prompts,
        ...(warnings.length ? { warnings } : {}),
      }
      const cache = await this.readCache()
      cache[serverId] = discovery
      await this.storage.setLocal(MCP_DISCOVERY_CACHE_KEY, cache)
      return discovery
    } catch (error) {
      throw classifyError(error)
    } finally {
      this.scheduleClose(serverId)
    }
  }

  async getCachedDiscovery(serverId: string): Promise<McpDiscovery | undefined> {
    return (await this.readCache())[serverId]
  }

  async listCachedDiscoveries(): Promise<McpDiscovery[]> {
    return Object.values(await this.readCache()).sort((a, b) =>
      a.serverName.localeCompare(b.serverName),
    )
  }

  async clearCachedDiscovery(serverId: string): Promise<void> {
    const cache = await this.readCache()
    delete cache[serverId]
    await this.storage.setLocal(MCP_DISCOVERY_CACHE_KEY, cache)
  }

  async callTool(
    serverId: string,
    toolName: string,
    args: Record<string, unknown>,
    options: { signal?: AbortSignal; maxResultChars?: number } = {},
  ): Promise<NormalizedMcpToolResult> {
    const server = await this.requireServer(serverId)
    if (server.tools[toolName]?.enabled === false) {
      throw new McpClientError(`MCP tool "${serverId}/${toolName}" is disabled`, 'configuration')
    }
    const connection = await this.getConnection(serverId)
    try {
      const result = await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        {
          timeout: this.requestTimeoutMs,
          signal: options.signal,
        },
      )
      return normalizeMcpToolResult(
        result,
        { serverId, serverName: server.name ?? serverId, toolName },
        options.maxResultChars,
      )
    } catch (error) {
      throw classifyError(error)
    } finally {
      this.scheduleClose(serverId)
    }
  }

  async listResources(serverId: string): Promise<McpDiscoveredResource[]> {
    const connection = await this.getConnection(serverId)
    try {
      if (!connection.client.getServerCapabilities()?.resources) return []
      return await this.collectPages(async (cursor) => {
        const page = await connection.client.listResources(cursor ? { cursor } : undefined, {
          timeout: this.requestTimeoutMs,
        })
        return { items: page.resources, nextCursor: page.nextCursor }
      })
    } catch (error) {
      throw classifyError(error)
    } finally {
      this.scheduleClose(serverId)
    }
  }

  async readResource(serverId: string, uri: string): Promise<unknown> {
    const connection = await this.getConnection(serverId)
    try {
      const result = await connection.client.readResource(
        { uri },
        { timeout: this.requestTimeoutMs },
      )
      return normalizeMcpToolResult(
        { content: result.contents.map((content) => ({ type: 'resource', resource: content })) },
        {
          serverId,
          serverName: (await this.requireServer(serverId)).name ?? serverId,
          toolName: 'resources/read',
        },
      )
    } catch (error) {
      throw classifyError(error)
    } finally {
      this.scheduleClose(serverId)
    }
  }

  async beginOAuth(
    serverId: string,
    redirectUrl = this.resolveRedirectUrl(),
  ): Promise<{ authorizationUrl: string; state: string }> {
    const server = await this.requireServer(serverId)
    if (server.auth.mode !== 'oauth') {
      throw new McpClientError('Set this MCP server auth mode to OAuth first', 'configuration')
    }
    let authorizationUrl: URL | undefined
    const provider = new McpOAuthClientProvider(serverId, this.vault, redirectUrl, (url) => {
      authorizationUrl = url
    })
    const result = await auth(provider, {
      serverUrl: server.url,
      fetchFn: this.fetchWithHeaders(server.headers),
    })
    if (result !== 'REDIRECT' || !authorizationUrl) {
      if (result === 'AUTHORIZED') {
        throw new McpClientError('This MCP server is already authorized', 'auth')
      }
      throw new McpClientError('MCP OAuth server did not provide an authorization URL', 'auth')
    }
    return {
      authorizationUrl: authorizationUrl.toString(),
      state: (await provider.expectedState()) ?? '',
    }
  }

  async completeOAuth(
    serverId: string,
    callbackUrl: string,
    redirectUrl = this.resolveRedirectUrl(),
  ): Promise<McpHealth> {
    const server = await this.requireServer(serverId)
    const callback = new URL(callbackUrl)
    const oauthError = callback.searchParams.get('error')
    if (oauthError) {
      throw new McpClientError(
        `MCP OAuth authorization failed: ${callback.searchParams.get('error_description') ?? oauthError}`,
        'auth',
      )
    }
    const code = callback.searchParams.get('code')
    if (!code)
      throw new McpClientError('MCP OAuth callback is missing an authorization code', 'auth')

    const provider = new McpOAuthClientProvider(serverId, this.vault, redirectUrl)
    const expectedState = await provider.expectedState()
    const returnedState = callback.searchParams.get('state')
    if (expectedState && returnedState !== expectedState) {
      throw new McpClientError('MCP OAuth state mismatch; restart authorization', 'auth')
    }
    const result = await auth(provider, {
      serverUrl: server.url,
      authorizationCode: code,
      fetchFn: this.fetchWithHeaders(server.headers),
    })
    if (result !== 'AUTHORIZED') {
      throw new McpClientError('MCP OAuth token exchange did not complete', 'auth')
    }
    await this.close(serverId)
    return this.testConnection(serverId)
  }

  async disconnectOAuth(serverId: string): Promise<void> {
    await this.close(serverId)
    await this.vault.deleteMcp(serverId, 'oauth')
  }

  async close(serverId: string): Promise<void> {
    const connection = this.connections.get(serverId)
    if (!connection) return
    this.connections.delete(serverId)
    if (connection.idleTimer) clearTimeout(connection.idleTimer)
    try {
      await connection.transport.close()
    } catch {
      // A dead service-worker transport is already effectively closed.
    }
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.connections.keys()].map((serverId) => this.close(serverId)))
  }

  private async requireServer(serverId: string): Promise<McpServerConfig> {
    const server = (await this.config.get()).mcp[serverId]
    if (!server) throw new McpClientError(`Unknown MCP server "${serverId}"`, 'configuration')
    if (!server.enabled) {
      throw new McpClientError(`MCP server "${serverId}" is disabled`, 'configuration')
    }
    return server
  }

  private async getConnection(serverId: string): Promise<Connection> {
    const server = await this.requireServer(serverId)
    const fingerprint = configFingerprint(server)
    const existing = this.connections.get(serverId)
    if (existing?.fingerprint === fingerprint) {
      if (existing.idleTimer) clearTimeout(existing.idleTimer)
      existing.idleTimer = undefined
      return existing
    }
    if (existing) await this.close(serverId)

    const authProvider =
      server.auth.mode === 'oauth'
        ? new McpOAuthClientProvider(serverId, this.vault, this.resolveRedirectUrl())
        : undefined
    const headers = await this.resolveHeaders(serverId, server)
    const order: McpTransportKind[] =
      server.transport === 'auto' ? ['streamable-http', 'sse'] : [server.transport]
    let firstError: unknown

    for (const kind of order) {
      try {
        const created = this.options.connectionFactory
          ? await this.options.connectionFactory({
              serverId,
              server,
              kind,
              headers,
              authProvider,
              fetch: this.fetchImpl,
            })
          : await this.connectSdk(server, kind, headers, authProvider)
        const connection: Connection = {
          ...created,
          kind,
          fingerprint,
        }
        this.connections.set(serverId, connection)
        return connection
      } catch (error) {
        firstError ??= error
        if (
          kind !== 'streamable-http' ||
          server.transport !== 'auto' ||
          !shouldFallBackToSse(error)
        ) {
          throw classifyError(error)
        }
      }
    }
    throw classifyError(firstError)
  }

  private async connectSdk(
    server: McpServerConfig,
    kind: McpTransportKind,
    headers: Record<string, string>,
    authProvider?: OAuthClientProvider,
  ): Promise<{ client: Client; transport: Transport }> {
    const client = new Client({ name: 'browser-agent', version: '0.0.1' }, { capabilities: {} })
    const requestInit: RequestInit = { headers }
    const transport: Transport =
      kind === 'streamable-http'
        ? new StreamableHTTPClientTransport(new URL(server.url), {
            authProvider,
            requestInit,
            fetch: this.fetchImpl,
            reconnectionOptions: {
              initialReconnectionDelay: 500,
              maxReconnectionDelay: 5_000,
              reconnectionDelayGrowFactor: 2,
              maxRetries: 1,
            },
          })
        : new SSEClientTransport(new URL(server.url), {
            authProvider,
            requestInit,
            fetch: this.fetchImpl,
          })
    try {
      await client.connect(transport, { timeout: this.requestTimeoutMs })
      return { client, transport }
    } catch (error) {
      try {
        await transport.close()
      } catch {
        // Preserve the connection error.
      }
      throw error
    }
  }

  private async resolveHeaders(
    serverId: string,
    server: McpServerConfig,
  ): Promise<Record<string, string>> {
    const headers = { ...server.headers }
    if (server.auth.mode === 'none' || server.auth.mode === 'oauth') return headers
    const credential = await this.vault.getMcp(serverId, 'api')
    if (!credential) {
      throw new McpClientError(
        `MCP server "${serverId}" needs a ${server.auth.mode === 'bearer' ? 'bearer token' : 'secret API header'}`,
        'auth',
      )
    }
    const headerName =
      server.auth.mode === 'bearer'
        ? 'Authorization'
        : server.auth.headerName?.trim() || 'X-API-Key'
    headers[headerName] =
      server.auth.mode === 'bearer' ? `Bearer ${credential.secret}` : credential.secret
    return headers
  }

  private fetchWithHeaders(headers: Record<string, string>): FetchLike {
    return (input, init) => {
      const merged = new Headers(init?.headers)
      for (const [name, value] of Object.entries(headers)) merged.set(name, value)
      return this.fetchImpl(input, { ...init, headers: merged })
    }
  }

  private protocolVersion(connection: Connection): string {
    return connection.transport instanceof StreamableHTTPClientTransport
      ? (connection.transport.protocolVersion ?? MCP_PROTOCOL_VERSION)
      : MCP_PROTOCOL_VERSION
  }

  private scheduleClose(serverId: string): void {
    const connection = this.connections.get(serverId)
    if (!connection) return
    if (connection.idleTimer) clearTimeout(connection.idleTimer)
    connection.idleTimer = setTimeout(() => void this.close(serverId), this.idleMs)
  }

  private async collectPages<T>(
    load: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string }>,
  ): Promise<T[]> {
    const items: T[] = []
    let cursor: string | undefined
    for (let pageNumber = 0; pageNumber < 100; pageNumber += 1) {
      const page = await load(cursor)
      items.push(...page.items)
      if (!page.nextCursor || page.nextCursor === cursor) break
      cursor = page.nextCursor
    }
    return items
  }

  private async readCache(): Promise<DiscoveryCache> {
    const cache = await this.storage.getLocal<DiscoveryCache>(MCP_DISCOVERY_CACHE_KEY)
    return cache && typeof cache === 'object' ? { ...cache } : {}
  }

  private resolveRedirectUrl(): string {
    const configured = this.options.oauthRedirectUrl
    if (typeof configured === 'function') return configured()
    if (configured) return configured
    return 'https://localhost/mcp-oauth-callback'
  }
}
