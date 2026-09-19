import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '../config/service.js'
import { createMemoryStorage, VAULT_LOCAL_KEY } from '../config/storage.js'
import { CredentialVault } from '../vault/vault.js'
import { MCP_OAUTH_PENDING_TTL_MS, McpOAuthClientProvider } from './oauth.js'
import { RemoteMcpRegistry } from './registry.js'

describe('MCP OAuth 2.1', () => {
  it('discovers metadata, uses PKCE/resource indicators, and encrypts refresh tokens', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    await config.set({
      mcp: {
        oauth: {
          name: 'OAuth MCP',
          url: 'https://mcp.example/mcp',
          auth: { mode: 'oauth' },
        },
      },
    })

    const tokenBodies: URLSearchParams[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.includes('oauth-protected-resource')) {
        return Response.json({
          resource: 'https://mcp.example/mcp',
          authorization_servers: ['https://auth.example'],
          scopes_supported: ['mcp:tools'],
        })
      }
      if (url.hostname === 'auth.example' && url.pathname.includes('.well-known')) {
        return Response.json({
          issuer: 'https://auth.example',
          authorization_endpoint: 'https://auth.example/authorize',
          token_endpoint: 'https://auth.example/token',
          registration_endpoint: 'https://auth.example/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      }
      if (url.href === 'https://auth.example/register') {
        return Response.json({
          client_id: 'browser-agent-test',
          redirect_uris: ['https://extension.chromiumapp.org/mcp'],
          token_endpoint_auth_method: 'none',
        })
      }
      if (url.href === 'https://auth.example/token') {
        const body = new URLSearchParams(String(init?.body ?? ''))
        tokenBodies.push(body)
        return Response.json({
          access_token: 'access-secret',
          refresh_token: 'refresh-secret',
          token_type: 'Bearer',
          expires_in: 3600,
          scope: 'mcp:tools',
        })
      }
      throw new Error(`Unexpected OAuth request: ${url}`)
    })

    const fakeClient = {
      ping: vi.fn().mockResolvedValue({}),
      getServerVersion: () => ({ name: 'oauth-server', version: '1.0.0' }),
    } as unknown as Client
    const fakeTransport = { close: vi.fn() } as unknown as Transport
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      fetch: fetchMock as typeof fetch,
      oauthRedirectUrl: 'https://extension.chromiumapp.org/mcp',
      connectionFactory: async () => ({ client: fakeClient, transport: fakeTransport }),
    })

    const pending = await registry.beginOAuth('oauth')
    const authorize = new URL(pending.authorizationUrl)
    expect(authorize.origin + authorize.pathname).toBe('https://auth.example/authorize')
    expect(authorize.searchParams.get('code_challenge_method')).toBe('S256')
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy()
    expect(authorize.searchParams.get('resource')).toBe('https://mcp.example/mcp')
    expect(authorize.searchParams.get('state')).toBe(pending.state)

    const health = await registry.completeOAuth(
      'oauth',
      `https://extension.chromiumapp.org/mcp?code=test-code&state=${pending.state}`,
      undefined,
      pending.generation,
    )
    expect(health.ok).toBe(true)
    expect(tokenBodies).toHaveLength(1)
    expect(tokenBodies[0]!.get('code')).toBe('test-code')
    expect(tokenBodies[0]!.get('code_verifier')?.length).toBeGreaterThan(40)
    expect(tokenBodies[0]!.get('resource')).toBe('https://mcp.example/mcp')
    expect((await vault.getMcp('oauth', 'oauth'))?.secret).not.toContain('"state"')
    expect((await vault.getMcp('oauth', 'oauth'))?.secret).not.toContain('"codeVerifier"')
    expect((await vault.getMcp('oauth', 'oauth'))?.secret).not.toContain('"pendingGeneration"')

    const encrypted = await storage.getLocal<unknown>(VAULT_LOCAL_KEY)
    expect(JSON.stringify(encrypted)).not.toContain('access-secret')
    expect(JSON.stringify(encrypted)).not.toContain('refresh-secret')
    expect(await vault.listMcp()).toEqual([{ serverId: 'oauth', type: 'oauth' }])
    await registry.closeAll()
  })

  it('rejects callback state mismatches before token exchange', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    await config.set({
      mcp: {
        oauth: {
          url: 'https://mcp.example/mcp',
          auth: { mode: 'oauth' },
        },
      },
    })
    await vault.setMcp(
      'oauth',
      JSON.stringify({
        state: 'expected',
        codeVerifier: 'verifier',
        pendingGeneration: 'expected-generation',
        pendingCreatedAt: Date.now(),
        pendingRedirectUrl: 'https://extension.chromiumapp.org/mcp',
      }),
      'oauth',
    )
    const fetchMock = vi.fn()
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      fetch: fetchMock as typeof fetch,
      oauthRedirectUrl: 'https://extension.chromiumapp.org/mcp',
    })
    await expect(
      registry.completeOAuth(
        'oauth',
        'https://extension.chromiumapp.org/mcp?code=test&state=attacker',
        undefined,
        'expected-generation',
      ),
    ).rejects.toThrow(/state mismatch/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uses a provider-registered public client and redirect without dynamic registration', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    await config.set({
      mcp: {
        oauth: {
          url: 'https://mcp.example/mcp',
          auth: {
            mode: 'oauth',
            oauth: {
              clientId: 'public-client-id',
              redirectUrl: 'https://app.example/oauth/callback',
            },
          },
        },
      },
    })
    const tokenBodies: URLSearchParams[] = []
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.includes('oauth-protected-resource')) {
        return Response.json({
          resource: 'https://mcp.example/mcp',
          authorization_servers: ['https://auth.example'],
        })
      }
      if (url.hostname === 'auth.example' && url.pathname.includes('.well-known')) {
        return Response.json({
          issuer: 'https://auth.example',
          authorization_endpoint: 'https://auth.example/authorize',
          token_endpoint: 'https://auth.example/token',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      }
      if (url.href === 'https://auth.example/token') {
        tokenBodies.push(new URLSearchParams(String(init?.body ?? '')))
        return Response.json({
          access_token: 'test-access',
          refresh_token: 'test-refresh',
          token_type: 'Bearer',
        })
      }
      throw new Error(`Dynamic registration must not run: ${url}`)
    })
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      fetch: fetchMock as typeof fetch,
      connectionFactory: async () => ({
        client: {
          ping: vi.fn().mockResolvedValue({}),
          getServerVersion: () => ({ name: 'oauth-server', version: '1.0.0' }),
        } as unknown as Client,
        transport: { close: vi.fn() } as unknown as Transport,
      }),
    })

    const pending = await registry.beginOAuth('oauth', undefined, 'public-generation')
    const authorization = new URL(pending.authorizationUrl)
    expect(pending.redirectUrl).toBe('https://app.example/oauth/callback')
    expect(pending.usesConfiguredClient).toBe(true)
    expect(authorization.searchParams.get('client_id')).toBe('public-client-id')
    expect(authorization.searchParams.get('redirect_uri')).toBe('https://app.example/oauth/callback')

    await registry.completeOAuth(
      'oauth',
      `https://app.example/oauth/callback?code=test-code&state=${pending.state}`,
      undefined,
      pending.generation,
    )
    expect(tokenBodies[0]?.get('client_id')).toBe('public-client-id')
    await registry.closeAll()
  })

  it('classifies a rejected dynamic redirect as an actionable platform constraint', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    await config.set({
      mcp: { oauth: { url: 'https://mcp.example/mcp', auth: { mode: 'oauth' } } },
    })
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.includes('oauth-protected-resource')) {
        return Response.json({
          resource: 'https://mcp.example/mcp',
          authorization_servers: ['https://auth.example'],
        })
      }
      if (url.hostname === 'auth.example' && url.pathname.includes('.well-known')) {
        return Response.json({
          issuer: 'https://auth.example',
          authorization_endpoint: 'https://auth.example/authorize',
          token_endpoint: 'https://auth.example/token',
          registration_endpoint: 'https://auth.example/register',
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code'],
          token_endpoint_auth_methods_supported: ['none'],
        })
      }
      if (url.href === 'https://auth.example/register') {
        return Response.json(
          { error: 'invalid_redirect_uri', error_description: 'redirect URI is not allowed' },
          { status: 400 },
        )
      }
      throw new Error(`Unexpected request: ${url}`)
    })
    const registry = new RemoteMcpRegistry(config, vault, storage, {
      fetch: fetchMock as typeof fetch,
      oauthRedirectUrl: 'https://extension.chromiumapp.org/mcp',
    })

    await expect(registry.beginOAuth('oauth')).rejects.toMatchObject({
      code: 'oauth-redirect',
      action: expect.stringContaining('fine-grained PAT'),
    })
  })

  it('consumes OAuth state and PKCE once, and rejects expired or mismatched callbacks', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)
    let now = 1_000
    const createProvider = () =>
      new McpOAuthClientProvider(
        'oauth',
        vault,
        'https://extension.chromiumapp.org/mcp',
        undefined,
        { now: () => now, pendingTtlMs: MCP_OAUTH_PENDING_TTL_MS },
      )

    const mismatch = createProvider()
    await mismatch.beginAuthorization('mismatch-generation')
    const mismatchState = await mismatch.state()
    await mismatch.saveCodeVerifier('mismatch-verifier')
    await expect(
      mismatch.consumePendingAuthorization(
        'https://extension.chromiumapp.org/mcp?code=unused&state=wrong-state',
        'mismatch-generation',
      ),
    ).rejects.toThrow(/state mismatch/)
    expect(await mismatch.expectedState()).toBeUndefined()

    const expired = createProvider()
    await expired.beginAuthorization('expired-generation')
    const expiredState = await expired.state()
    await expired.saveCodeVerifier('expired-verifier')
    now += MCP_OAUTH_PENDING_TTL_MS + 1
    await expect(
      expired.consumePendingAuthorization(
        `https://extension.chromiumapp.org/mcp?code=unused&state=${expiredState}`,
        'expired-generation',
      ),
    ).rejects.toThrow(/expired/)
    expect(await expired.expectedState()).toBeUndefined()

    now = 10_000
    const replay = createProvider()
    await replay.beginAuthorization('replay-generation')
    const replayState = await replay.state()
    await replay.saveCodeVerifier('one-time-verifier')
    const callback = `https://extension.chromiumapp.org/mcp?code=unused&state=${replayState}`
    await replay.consumePendingAuthorization(callback, 'replay-generation')
    expect(await replay.codeVerifier()).toBe('one-time-verifier')
    expect(await replay.expectedState()).toBeUndefined()
    await expect(replay.consumePendingAuthorization(callback, 'replay-generation')).rejects.toThrow(
      /no longer current/,
    )

    const wrongRedirect = createProvider()
    await wrongRedirect.beginAuthorization('redirect-generation')
    const redirectState = await wrongRedirect.state()
    await wrongRedirect.saveCodeVerifier('redirect-verifier')
    await expect(
      wrongRedirect.consumePendingAuthorization(
        `https://other.example/callback?code=unused&state=${redirectState}`,
        'redirect-generation',
      ),
    ).rejects.toThrow(/redirect URI/)
    expect(await wrongRedirect.expectedState()).toBeUndefined()

    const superseded = createProvider()
    await superseded.beginAuthorization('first-generation')
    const firstState = await superseded.state()
    await superseded.saveCodeVerifier('first-verifier')
    await superseded.beginAuthorization('second-generation')
    const secondState = await superseded.state()
    await superseded.saveCodeVerifier('second-verifier')
    await expect(
      superseded.consumePendingAuthorization(
        `https://extension.chromiumapp.org/mcp?code=unused&state=${firstState}`,
        'first-generation',
      ),
    ).rejects.toThrow(/no longer current/)
    await superseded.consumePendingAuthorization(
      `https://extension.chromiumapp.org/mcp?code=unused&state=${secondState}`,
      'second-generation',
    )
    expect(await superseded.codeVerifier()).toBe('second-verifier')

    const cancelled = createProvider()
    await cancelled.beginAuthorization('cancel-generation')
    await cancelled.state()
    await cancelled.saveCodeVerifier('cancelled-verifier')
    await cancelled.clearPendingAuthorization()
    expect(await cancelled.expectedState()).toBeUndefined()
    await expect(cancelled.codeVerifier()).rejects.toThrow(/PKCE verifier is missing/)
  })

  it('refreshes OAuth after a service-worker restart without deleting the vaulted credential', async () => {
    const storage = createMemoryStorage()
    const config = new ConfigService(storage)
    const vault = new CredentialVault(storage)
    await config.set({
      mcp: {
        oauth: {
          name: 'OAuth MCP',
          url: 'https://mcp.example/mcp',
          auth: { mode: 'oauth' },
        },
      },
    })
    await vault.setMcp(
      'oauth',
      JSON.stringify({
        tokens: {
          access_token: 'test-previous-access',
          refresh_token: 'test-refresh-marker',
          token_type: 'Bearer',
        },
        clientInformation: { client_id: 'browser-agent-test' },
        discovery: {
          authorizationServerUrl: 'https://auth.example',
          authorizationServerMetadata: {
            issuer: 'https://auth.example',
            authorization_endpoint: 'https://auth.example/authorize',
            token_endpoint: 'https://auth.example/token',
            response_types_supported: ['code'],
            token_endpoint_auth_methods_supported: ['none'],
          },
          resourceMetadata: {
            resource: 'https://mcp.example/mcp',
            authorization_servers: ['https://auth.example'],
          },
        },
      }),
      'oauth',
    )

    let refreshRequests = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.href === 'https://auth.example/token') {
        refreshRequests += 1
        const body = new URLSearchParams(String(init?.body ?? ''))
        expect(body.get('grant_type')).toBe('refresh_token')
        expect(body.get('refresh_token')).toBe('test-refresh-marker')
        return Response.json({
          access_token: 'test-refreshed-access',
          refresh_token: 'test-refresh-marker',
          token_type: 'Bearer',
        })
      }
      if (url.href !== 'https://mcp.example/mcp') {
        throw new Error(`Unexpected OAuth request: ${url}`)
      }

      const headers = new Headers(init?.headers)
      if (headers.get('authorization') !== 'Bearer test-refreshed-access') {
        return new Response(null, {
          status: 401,
          headers: {
            'www-authenticate':
              'Bearer resource_metadata="https://mcp.example/.well-known/oauth-protected-resource"',
          },
        })
      }
      const raw = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
      const request = Array.isArray(raw) ? raw[0] : raw
      const result =
        request?.method === 'initialize'
          ? {
              protocolVersion: '2025-11-25',
              capabilities: {},
              serverInfo: { name: 'oauth-mcp', version: '1.0.0' },
            }
          : {}
      return Response.json(
        { jsonrpc: '2.0', id: request?.id, result },
        { headers: { 'content-type': 'application/json', 'mcp-session-id': 'oauth-session' } },
      )
    })

    const firstWorkerRegistry = new RemoteMcpRegistry(config, vault, storage, {
      fetch: fetchMock as typeof fetch,
    })
    expect((await firstWorkerRegistry.testConnection('oauth')).ok).toBe(true)
    expect(refreshRequests).toBe(1)
    await firstWorkerRegistry.closeAll()

    const restartedWorkerRegistry = new RemoteMcpRegistry(config, vault, storage, {
      fetch: fetchMock as typeof fetch,
    })
    expect((await restartedWorkerRegistry.testConnection('oauth')).ok).toBe(true)
    expect(refreshRequests).toBe(1)
    expect((await vault.getMcp('oauth', 'oauth'))?.secret).toContain('test-refreshed-access')
    expect(JSON.stringify(await storage.getLocal<unknown>(VAULT_LOCAL_KEY))).not.toContain(
      'test-refreshed-access',
    )
    await restartedWorkerRegistry.closeAll()
  })
})
