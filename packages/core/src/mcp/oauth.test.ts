import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { describe, expect, it, vi } from 'vitest'
import { ConfigService } from '../config/service.js'
import { createMemoryStorage, VAULT_LOCAL_KEY } from '../config/storage.js'
import { CredentialVault } from '../vault/vault.js'
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
    )
    expect(health.ok).toBe(true)
    expect(tokenBodies).toHaveLength(1)
    expect(tokenBodies[0]!.get('code')).toBe('test-code')
    expect(tokenBodies[0]!.get('code_verifier')?.length).toBeGreaterThan(40)
    expect(tokenBodies[0]!.get('resource')).toBe('https://mcp.example/mcp')

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
      JSON.stringify({ state: 'expected', codeVerifier: 'verifier' }),
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
      ),
    ).rejects.toThrow(/state mismatch/)
    expect(fetchMock).not.toHaveBeenCalled()
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
