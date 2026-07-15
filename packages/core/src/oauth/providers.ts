import { createPkcePair } from './pkce.js'
import type { OAuthTokenPayload } from './tokens.js'
import { serializeOAuthPayload } from './tokens.js'

export type OAuthProviderId = 'openai' | 'anthropic'

export type OAuthPending = {
  providerId: OAuthProviderId
  verifier: string
  state: string
  redirectUri: string
  mode?: 'max' | 'console'
  createdAt: number
}

export type OAuthAuthorizeResult = {
  authUrl: string
  pending: OAuthPending
  /** URL prefix to watch for the authorization redirect */
  callbackUrlPrefix: string
}

export type OAuthTokenResult = {
  providerId: OAuthProviderId
  secret: string
  payload: OAuthTokenPayload
}

const OPENAI = {
  clientId: 'app_EMoamEEZ73f0CkXaXp7hrann',
  authorizeUrl: 'https://auth.openai.com/oauth/authorize',
  tokenUrl: 'https://auth.openai.com/oauth/token',
  /** Codex CLI registered redirect — capture via chrome.tabs even if localhost refuses. */
  redirectUri: 'http://localhost:1455/auth/callback',
  scope: 'openid profile email offline_access',
} as const

const ANTHROPIC = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrlMax: 'https://claude.ai/oauth/authorize',
  authorizeUrlConsole: 'https://console.anthropic.com/oauth/authorize',
  tokenUrl: 'https://console.anthropic.com/v1/oauth/token',
  redirectUri: 'https://console.anthropic.com/oauth/code/callback',
  createApiKeyUrl: 'https://api.anthropic.com/api/oauth/claude_cli/create_api_key',
  scope: 'org:create_api_key user:profile user:inference',
} as const

export function isOAuthProviderId(id: string): id is OAuthProviderId {
  return id === 'openai' || id === 'anthropic'
}

export async function buildAuthorizeUrl(
  providerId: OAuthProviderId,
  opts?: { mode?: 'max' | 'console' },
): Promise<OAuthAuthorizeResult> {
  const { verifier, challenge, state } = await createPkcePair()
  const mode = opts?.mode ?? (providerId === 'anthropic' ? 'console' : undefined)

  if (providerId === 'openai') {
    const url = new URL(OPENAI.authorizeUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('client_id', OPENAI.clientId)
    url.searchParams.set('redirect_uri', OPENAI.redirectUri)
    url.searchParams.set('scope', OPENAI.scope)
    url.searchParams.set('code_challenge', challenge)
    url.searchParams.set('code_challenge_method', 'S256')
    url.searchParams.set('state', state)
    url.searchParams.set('id_token_add_organizations', 'true')
    url.searchParams.set('codex_cli_simplified_flow', 'true')
    url.searchParams.set('originator', 'browser-agent')

    return {
      authUrl: url.toString(),
      callbackUrlPrefix: OPENAI.redirectUri,
      pending: {
        providerId,
        verifier,
        state,
        redirectUri: OPENAI.redirectUri,
        createdAt: Date.now(),
      },
    }
  }

  const authorizeBase = mode === 'max' ? ANTHROPIC.authorizeUrlMax : ANTHROPIC.authorizeUrlConsole
  const url = new URL(authorizeBase)
  url.searchParams.set('code', 'true')
  url.searchParams.set('client_id', ANTHROPIC.clientId)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', ANTHROPIC.redirectUri)
  url.searchParams.set('scope', ANTHROPIC.scope)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)

  return {
    authUrl: url.toString(),
    callbackUrlPrefix: ANTHROPIC.redirectUri,
    pending: {
      providerId,
      verifier,
      state,
      redirectUri: ANTHROPIC.redirectUri,
      mode: mode === 'max' ? 'max' : 'console',
      createdAt: Date.now(),
    },
  }
}

/**
 * Parse authorization code from a redirect URL.
 * Anthropic sometimes returns `code#state` in the query `code` param or fragment.
 */
export function parseCallbackUrl(
  callbackUrl: string,
  expectedState: string,
): { code: string; state: string } {
  const url = new URL(callbackUrl)
  const error = url.searchParams.get('error')
  if (error) {
    const description = url.searchParams.get('error_description') ?? error
    throw new Error(`OAuth error: ${description}`)
  }

  let code = url.searchParams.get('code') ?? ''
  let state = url.searchParams.get('state') ?? ''

  // Anthropic paste format: code#state (sometimes in the code param itself)
  if (code.includes('#')) {
    const [c, s] = code.split('#')
    code = c ?? ''
    if (s) state = s
  }

  if (!state && url.hash) {
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''))
    state = hashParams.get('state') ?? state
    if (!code) code = hashParams.get('code') ?? ''
  }

  if (!code) {
    throw new Error('No authorization code in OAuth callback')
  }
  if (state && state !== expectedState) {
    throw new Error('OAuth state mismatch')
  }

  return { code, state: state || expectedState }
}

/** Accept raw paste: full URL, `code#state`, or bare code. */
export function parseAuthorizationInput(
  input: string,
  expectedState: string,
): { code: string; state: string } {
  const trimmed = input.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return parseCallbackUrl(trimmed, expectedState)
  }
  if (trimmed.includes('#')) {
    const [code, state] = trimmed.split('#')
    if (!code) throw new Error('Invalid authorization code')
    if (state && state !== expectedState) throw new Error('OAuth state mismatch')
    return { code, state: state || expectedState }
  }
  return { code: trimmed, state: expectedState }
}

async function exchangeOpenAI(code: string, pending: OAuthPending): Promise<OAuthTokenResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    client_id: OPENAI.clientId,
    code_verifier: pending.verifier,
  })

  const tokenRes = await fetch(OPENAI.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  if (!tokenRes.ok) {
    throw new Error(`OpenAI token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
    id_token?: string
  }

  let accessToken = tokenData.access_token
  if (tokenData.id_token) {
    try {
      accessToken = await exchangeOpenAIApiKey(tokenData.id_token)
    } catch {
      // Fall back to access_token (Codex backend) if API key exchange fails
    }
  }

  const accountId = decodeJwtAccountId(tokenData.access_token) ?? decodeJwtAccountId(tokenData.id_token)

  const payload: OAuthTokenPayload = {
    accessToken,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
    accountId: accountId ?? undefined,
  }

  return {
    providerId: 'openai',
    secret: serializeOAuthPayload(payload),
    payload,
  }
}

async function exchangeOpenAIApiKey(idToken: string): Promise<string> {
  const res = await fetch(OPENAI.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      client_id: OPENAI.clientId,
      requested_token: 'openai-api-key',
      subject_token: idToken,
      subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`OpenAI API key exchange failed: ${res.status}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

async function exchangeAnthropic(code: string, pending: OAuthPending): Promise<OAuthTokenResult> {
  const cleanedCode = code.split('#')[0]?.split('&')[0] ?? code

  const tokenRes = await fetch(ANTHROPIC.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: ANTHROPIC.clientId,
      code: cleanedCode,
      redirect_uri: pending.redirectUri,
      code_verifier: pending.verifier,
      state: pending.state,
    }),
  })
  if (!tokenRes.ok) {
    throw new Error(`Anthropic token exchange failed: ${tokenRes.status} ${await tokenRes.text()}`)
  }

  const tokenData = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }

  let accessToken = tokenData.access_token

  // Console mode: mint a durable API key from the OAuth access token
  if (pending.mode !== 'max') {
    try {
      const keyRes = await fetch(ANTHROPIC.createApiKeyUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
      })
      if (keyRes.ok) {
        const keyData = (await keyRes.json()) as { raw_key?: string; key?: string }
        accessToken = keyData.raw_key ?? keyData.key ?? accessToken
      }
    } catch {
      // Keep OAuth access token if key creation fails
    }
  }

  const payload: OAuthTokenPayload = {
    accessToken,
    refreshToken: tokenData.refresh_token,
    expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : undefined,
    meta: { mode: pending.mode ?? 'console' },
  }

  return {
    providerId: 'anthropic',
    secret: serializeOAuthPayload(payload),
    payload,
  }
}

export async function exchangeAuthorizationCode(
  pending: OAuthPending,
  authorizationInput: string,
): Promise<OAuthTokenResult> {
  const { code } = parseAuthorizationInput(authorizationInput, pending.state)
  if (pending.providerId === 'openai') {
    return exchangeOpenAI(code, pending)
  }
  return exchangeAnthropic(code, pending)
}

export async function refreshOAuthToken(
  providerId: OAuthProviderId,
  refreshToken: string,
): Promise<OAuthTokenPayload> {
  if (providerId === 'openai') {
    const res = await fetch(OPENAI.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: OPENAI.clientId,
      }),
    })
    if (!res.ok) {
      throw new Error(`OpenAI token refresh failed: ${res.status}`)
    }
    const data = (await res.json()) as {
      access_token: string
      refresh_token?: string
      expires_in?: number
    }
    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
    }
  }

  const res = await fetch(ANTHROPIC.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: ANTHROPIC.clientId,
    }),
  })
  if (!res.ok) {
    throw new Error(`Anthropic token refresh failed: ${res.status}`)
  }
  const data = (await res.json()) as {
    access_token: string
    refresh_token?: string
    expires_in?: number
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  }
}

function decodeJwtAccountId(token?: string): string | null {
  if (!token) return null
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      chatgpt_account_id?: string
      'https://api.openai.com/auth'?: { chatgpt_account_id?: string }
    }
    return (
      payload.chatgpt_account_id ??
      payload['https://api.openai.com/auth']?.chatgpt_account_id ??
      null
    )
  } catch {
    return null
  }
}
