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
    readonly action?: string,
  ) {
    super(message)
    this.name = 'McpClientError'
  }
}

const BEARER_CREDENTIAL = /\bbearer\s+[a-z0-9\-._~+/]+=*/gi
const SENSITIVE_PARAMETER =
  /([?&](?:access_token|refresh_token|token|api[_-]?key|client_secret)=)[^&#\s]+/gi
const SENSITIVE_HEADER =
  /(\b(?:authorization|proxy-authorization|access_token|refresh_token|token|api[_-]?key|client_secret)\b\s*[:=]\s*)(?:bearer\s+)?[^\s,;]+/gi

function redactMcpErrorDetail(value: string): string {
  return value
    .replace(BEARER_CREDENTIAL, 'Bearer [REDACTED]')
    .replace(SENSITIVE_PARAMETER, '$1[REDACTED]')
    .replace(SENSITIVE_HEADER, '$1[REDACTED]')
}

function formatError(error: unknown): string {
  const value = error instanceof Error ? error.message : typeof error === 'string' ? error : String(error)
  return redactMcpErrorDetail(value)
}

function httpStatus(error: unknown, message: string): number | undefined {
  if (
    (error instanceof StreamableHTTPError || error instanceof SseError) &&
    typeof error.code === 'number'
  ) {
    return error.code
  }
  const match = message.match(/\b(?:http|status|error)\s*(?:code)?\s*[:(]?\s*(401|403|404|405|406|415|501)\b/i)
  return match?.[1] ? Number(match[1]) : undefined
}

function classifyError(error: unknown): McpClientError {
  if (error instanceof McpClientError) return error
  const message = formatError(error)
  const lower = message.toLowerCase()
  const status = httpStatus(error, message)
  if (
    error instanceof UnauthorizedError ||
    status === 401 ||
    status === 403 ||
    lower.includes('unauthorized') ||
    lower.includes('oauth')
  ) {
    return new McpClientError(
      'Authentication is required, expired, or lacks the requested access.',
      'auth',
      error,
      'Save a valid bearer/API credential or reconnect OAuth, then test the server again.',
    )
  }
  if (lower.includes('cors') || lower.includes('access-control-allow-origin')) {
    return new McpClientError(
      'The MCP endpoint blocked this extension request with CORS.',
      'cors',
      error,
      'Allow the extension origin and the Authorization, Content-Type, MCP-Protocol-Version, and Mcp-Session-Id request headers on the MCP endpoint.',
    )
  }
  if (
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('econnrefused') ||
    lower.includes('dns') ||
    lower.includes('enotfound') ||
    lower.includes('timed out')
  ) {
    return new McpClientError(
      'The MCP endpoint could not be reached.',
      'network',
      error,
      'Verify the HTTPS URL, DNS/network access, and that the extension has host permission for the endpoint.',
    )
  }
  if (error instanceof StreamableHTTPError || error instanceof SseError) {
    if (status !== undefined && status >= 500) {
      return new McpClientError(
        'The remote MCP server returned an internal error.',
        'server',
        error,
        'Retry later or check the remote MCP server status.',
      )
    }
    return new McpClientError(
      'The MCP endpoint does not support the selected transport.',
      'transport',
      error,
      'Use Auto only when the endpoint may support legacy SSE; otherwise select the transport documented by the server.',
    )
  }
  if (
    lower.includes('json-rpc') ||
    lower.includes('protocol') ||
    lower.includes('initialize') ||
    lower.includes('parse')
  ) {
    return new McpClientError(
      `The endpoint did not complete a compatible MCP ${MCP_PROTOCOL_VERSION} handshake.`,
      'protocol',
      error,
      'Confirm that the URL is the remote MCP endpoint rather than a provider web page or API root.',
    )
  }
  return new McpClientError(
    'The remote MCP server returned an unexpected error.',
    'server',
    error,
    'Retry the request and inspect the sanitized diagnostic detail if the problem persists.',
  )
}

function shouldFallBackToSse(error: unknown): boolean {
  if (!(error instanceof StreamableHTTPError)) return false
  // A fallback is safe only when the endpoint explicitly rejects Streamable
  // HTTP negotiation. Never retry a credential, CORS, or network failure as
  // legacy SSE: that masks the actionable root cause and creates extra traffic.
  return [404, 405, 406, 415, 501].includes(error.code ?? -1)
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
          action:
            healthError.action ??
            'Check the MCP server configuration and retry the connection test.',
          ...(healthError.cause === undefined
            ? {}
            : { detail: formatError(healthError.cause) }),
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
        this.observeTransportClose(serverId, connection)
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

  /**
   * A remote transport can close independently of the MV3 service worker.
   * Forget it immediately so the next request creates a fresh transport and
   * loads the same credential material from the encrypted vault.
   */
  private observeTransportClose(serverId: string, connection: Connection): void {
    const previousOnClose = connection.transport.onclose
    connection.transport.onclose = () => {
      try {
        previousOnClose?.()
      } finally {
        if (this.connections.get(serverId) !== connection) return
        this.connections.delete(serverId)
        if (connection.idleTimer) clearTimeout(connection.idleTimer)
      }
    }
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
