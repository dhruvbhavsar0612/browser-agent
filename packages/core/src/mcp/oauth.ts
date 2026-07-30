import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js'
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js'
import type { CredentialVault } from '../vault/index.js'

interface StoredMcpOAuth {
  tokens?: OAuthTokens
  clientInformation?: OAuthClientInformationMixed
  codeVerifier?: string
  state?: string
  pendingGeneration?: string
  pendingCreatedAt?: number
  pendingRedirectUrl?: string
  discovery?: OAuthDiscoveryState
}

export const MCP_OAUTH_PENDING_TTL_MS = 5 * 60 * 1000

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class McpOAuthClientProvider implements OAuthClientProvider {
  private authorizationUrl: URL | undefined
  private consumedCodeVerifier: string | undefined

  constructor(
    readonly serverId: string,
    private readonly vault: CredentialVault,
    readonly redirectUrl: string,
    private readonly onRedirect?: (url: URL) => void | Promise<void>,
    private readonly options: {
      now?: () => number
      pendingTtlMs?: number
      clientId?: string
    } = {},
  ) {}

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Browser Agent Remote MCP',
      redirect_uris: [this.redirectUrl],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }
  }

  async state(): Promise<string> {
    const state = randomState()
    await this.update({
      state,
      pendingCreatedAt: this.now(),
      pendingRedirectUrl: this.redirectUrl,
    })
    return state
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    if (this.options.clientId) return { client_id: this.options.clientId }
    return (await this.read()).clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
    if (this.options.clientId) return
    await this.update({ clientInformation })
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.read()).tokens
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    await this.update({ tokens })
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.authorizationUrl = authorizationUrl
    await this.onRedirect?.(authorizationUrl)
  }

  get pendingAuthorizationUrl(): URL | undefined {
    return this.authorizationUrl
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    const current = await this.read()
    await this.write({
      ...current,
      codeVerifier,
      pendingCreatedAt: current.pendingCreatedAt ?? this.now(),
      pendingRedirectUrl: current.pendingRedirectUrl ?? this.redirectUrl,
    })
  }

  async codeVerifier(): Promise<string> {
    if (this.consumedCodeVerifier) return this.consumedCodeVerifier
    const verifier = (await this.read()).codeVerifier
    if (!verifier) throw new Error('MCP OAuth PKCE verifier is missing; start authorization again')
    return verifier
  }

  async saveDiscoveryState(discovery: OAuthDiscoveryState): Promise<void> {
    await this.update({ discovery })
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.read()).discovery
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'all') {
      await this.vault.deleteMcp(this.serverId, 'oauth')
      return
    }
    const current = await this.read()
    if (scope === 'client') delete current.clientInformation
    if (scope === 'tokens') delete current.tokens
    if (scope === 'verifier') this.removePending(current)
    if (scope === 'discovery') delete current.discovery
    await this.write(current)
  }

  async expectedState(): Promise<string | undefined> {
    return (await this.read()).state
  }

  /**
   * Each browser authorization request receives a fresh state/verifier pair.
   * Existing tokens, registration, and discovery data remain intact.
   */
  async beginAuthorization(generation: string = crypto.randomUUID()): Promise<void> {
    const current = await this.read()
    this.consumedCodeVerifier = undefined
    this.removePending(current)
    await this.write({ ...current, pendingGeneration: generation })
  }

  /**
   * Validates and atomically consumes the state/PKCE pair before code exchange.
   * The verifier stays only in this provider instance for the exchange, making
   * the callback one-time even if the service worker receives a replay.
   */
  async consumePendingAuthorization(callbackUrl: string, generation?: string): Promise<void> {
    const current = await this.read()
    if (!generation || current.pendingGeneration !== generation) {
      throw new Error('MCP OAuth attempt is no longer current; restart authorization')
    }
    let callback: URL
    try {
      callback = new URL(callbackUrl)
    } catch {
      this.removePending(current)
      await this.write(current)
      throw new Error('MCP OAuth callback URL is invalid')
    }
    const expectedRedirect = current.pendingRedirectUrl ?? this.redirectUrl

    if (!sameCallbackTarget(callback, expectedRedirect)) {
      this.removePending(current)
      await this.write(current)
      throw new Error('MCP OAuth callback does not match the registered redirect URI')
    }
    if (
      !current.state ||
      !current.codeVerifier ||
      !Number.isFinite(current.pendingCreatedAt) ||
      this.now() - current.pendingCreatedAt! > this.pendingTtlMs ||
      current.pendingCreatedAt! > this.now()
    ) {
      this.removePending(current)
      await this.write(current)
      throw new Error('MCP OAuth authorization has expired; start authorization again')
    }

    const returnedState = callback.searchParams.get('state')
    if (returnedState !== current.state) {
      this.removePending(current)
      await this.write(current)
      throw new Error('MCP OAuth state mismatch; restart authorization')
    }

    this.consumedCodeVerifier = current.codeVerifier
    this.removePending(current)
    await this.write(current)
  }

  async clearPendingAuthorization(generation?: string): Promise<boolean> {
    this.consumedCodeVerifier = undefined
    const current = await this.read()
    if (generation && current.pendingGeneration !== generation) return false
    this.removePending(current)
    await this.write(current)
    return true
  }

  async disconnect(): Promise<void> {
    await this.vault.deleteMcp(this.serverId, 'oauth')
  }

  private get pendingTtlMs(): number {
    return this.options.pendingTtlMs ?? MCP_OAUTH_PENDING_TTL_MS
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }

  private removePending(value: StoredMcpOAuth): void {
    delete value.state
    delete value.codeVerifier
    delete value.pendingGeneration
    delete value.pendingCreatedAt
    delete value.pendingRedirectUrl
  }

  private async read(): Promise<StoredMcpOAuth> {
    const credential = await this.vault.getMcp(this.serverId, 'oauth')
    if (!credential) return {}
    try {
      const parsed = JSON.parse(credential.secret)
      return parsed && typeof parsed === 'object' ? (parsed as StoredMcpOAuth) : {}
    } catch {
      throw new Error('Stored MCP OAuth credential is invalid; disconnect and reconnect the server')
    }
  }

  private async update(patch: Partial<StoredMcpOAuth>): Promise<void> {
    await this.write({ ...(await this.read()), ...patch })
  }

  private async write(value: StoredMcpOAuth): Promise<void> {
    if (Object.keys(value).length === 0) {
      await this.vault.deleteMcp(this.serverId, 'oauth')
      return
    }
    await this.vault.setMcp(this.serverId, JSON.stringify(value), 'oauth')
  }
}

function sameCallbackTarget(callback: URL, redirectUrl: string): boolean {
  try {
    const expected = new URL(redirectUrl)
    return callback.origin === expected.origin && callback.pathname === expected.pathname
  } catch {
    return false
  }
}
