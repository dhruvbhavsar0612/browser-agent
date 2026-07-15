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
  discovery?: OAuthDiscoveryState
}

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export class McpOAuthClientProvider implements OAuthClientProvider {
  private authorizationUrl: URL | undefined

  constructor(
    readonly serverId: string,
    private readonly vault: CredentialVault,
    readonly redirectUrl: string,
    private readonly onRedirect?: (url: URL) => void | Promise<void>,
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
    const stored = await this.read()
    if (stored.state) return stored.state
    const state = randomState()
    await this.write({ ...stored, state })
    return state
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.read()).clientInformation
  }

  async saveClientInformation(clientInformation: OAuthClientInformationMixed): Promise<void> {
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
    await this.update({ codeVerifier })
  }

  async codeVerifier(): Promise<string> {
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
    if (scope === 'verifier') delete current.codeVerifier
    if (scope === 'discovery') delete current.discovery
    await this.write(current)
  }

  async expectedState(): Promise<string | undefined> {
    return (await this.read()).state
  }

  async disconnect(): Promise<void> {
    await this.vault.deleteMcp(this.serverId, 'oauth')
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
    await this.vault.setMcp(this.serverId, JSON.stringify(value), 'oauth')
  }
}
