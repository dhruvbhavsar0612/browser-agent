import { describe, expect, it } from 'vitest'
import { createPkcePair, generateCodeChallenge, generateCodeVerifier } from './pkce.js'
import {
  buildAuthorizeUrl,
  exchangeAuthorizationCode,
  isOAuthProviderId,
  parseAuthorizationInput,
  parseCallbackUrl,
} from './providers.js'
import {
  credentialSecretToApiKey,
  isOAuthExpired,
  parseOAuthPayload,
  serializeOAuthPayload,
} from './tokens.js'

describe('PKCE', () => {
  it('generates verifier and S256 challenge', async () => {
    const verifier = await generateCodeVerifier()
    expect(verifier.length).toBeGreaterThan(20)
    const challenge = await generateCodeChallenge(verifier)
    expect(challenge).not.toBe(verifier)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })

  it('createPkcePair returns distinct fields', async () => {
    const pair = await createPkcePair()
    expect(pair.verifier).toBeTruthy()
    expect(pair.challenge).toBeTruthy()
    expect(pair.state).toMatch(/^[a-f0-9]+$/)
  })
})

describe('OAuth tokens', () => {
  it('round-trips payload JSON', () => {
    const secret = serializeOAuthPayload({
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: 1_700_000_000_000,
    })
    expect(parseOAuthPayload(secret)).toEqual({
      accessToken: 'tok',
      refreshToken: 'ref',
      expiresAt: 1_700_000_000_000,
    })
  })

  it('treats plain secrets as access tokens', () => {
    expect(parseOAuthPayload('sk-ant-plain')).toEqual({ accessToken: 'sk-ant-plain' })
  })

  it('credentialSecretToApiKey prefers accessToken for oauth JSON', () => {
    const secret = serializeOAuthPayload({ accessToken: 'sk-from-oauth' })
    expect(credentialSecretToApiKey(secret, 'oauth')).toBe('sk-from-oauth')
    expect(credentialSecretToApiKey('sk-api', 'api')).toBe('sk-api')
  })

  it('isOAuthExpired respects buffer', () => {
    expect(isOAuthExpired({ accessToken: 'x', expiresAt: Date.now() + 120_000 }, 60_000)).toBe(
      false,
    )
    expect(isOAuthExpired({ accessToken: 'x', expiresAt: Date.now() + 10_000 }, 60_000)).toBe(true)
  })
})

describe('OAuth providers', () => {
  it('recognizes oauth provider ids', () => {
    expect(isOAuthProviderId('openai')).toBe(true)
    expect(isOAuthProviderId('anthropic')).toBe(true)
    expect(isOAuthProviderId('google')).toBe(false)
  })

  it('builds OpenAI authorize URL with PKCE', async () => {
    const result = await buildAuthorizeUrl('openai')
    expect(result.authUrl).toContain('auth.openai.com/oauth/authorize')
    expect(result.authUrl).toContain('code_challenge=')
    expect(result.authUrl).toContain('codex_cli_simplified_flow=true')
    expect(result.callbackUrlPrefix).toContain('localhost:1455')
    expect(result.pending.providerId).toBe('openai')
  })

  it('builds Anthropic console authorize URL', async () => {
    const result = await buildAuthorizeUrl('anthropic', { mode: 'console' })
    expect(result.authUrl).toContain('console.anthropic.com/oauth/authorize')
    expect(result.pending.mode).toBe('console')
  })

  it('parses callback URLs and paste formats', () => {
    const state = 'abc123'
    expect(
      parseCallbackUrl(`http://localhost:1455/auth/callback?code=CODE1&state=${state}`, state),
    ).toEqual({ code: 'CODE1', state })

    expect(parseAuthorizationInput(`CODE2#${state}`, state)).toEqual({ code: 'CODE2', state })
    expect(parseAuthorizationInput('BARECODE', state)).toEqual({ code: 'BARECODE', state })
  })

  it('rejects state mismatch', () => {
    expect(() =>
      parseCallbackUrl('http://localhost:1455/auth/callback?code=x&state=wrong', 'expected'),
    ).toThrow(/state mismatch/i)
  })

  it('exchangeAuthorizationCode posts to OpenAI token endpoint', async () => {
    const authorize = await buildAuthorizeUrl('openai')
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('/oauth/token') && init?.method === 'POST') {
        const body = String(init.body)
        expect(body).toContain('grant_type=authorization_code')
        expect(body).toContain(`code_verifier=${authorize.pending.verifier}`)
        return new Response(
          JSON.stringify({
            access_token: 'access',
            refresh_token: 'refresh',
            expires_in: 3600,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      throw new Error(`Unexpected fetch: ${url}`)
    }) as typeof fetch

    try {
      const result = await exchangeAuthorizationCode(authorize.pending, 'AUTHCODE')
      expect(result.providerId).toBe('openai')
      expect(result.payload.accessToken).toBe('access')
      expect(result.payload.refreshToken).toBe('refresh')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
