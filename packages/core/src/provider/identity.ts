/**
 * Client identity and request headers modeled after OpenCode's LLM request prep.
 * OpenCode Go requires a non-generic User-Agent and a stable session header:
 * https://opencode.ai/docs/go/#where-can-i-use-it
 */

export const CLIENT_ID = 'browser-agent'
export const CLIENT_VERSION = '1.0'
export const CLIENT_USER_AGENT = `${CLIENT_ID}/${CLIENT_VERSION}`
export const CLIENT_CHANNEL = 'chrome-extension'

export const OPENCODE_PROVIDER_IDS = ['opencode', 'opencode-go'] as const
export type OpenCodeProviderId = (typeof OPENCODE_PROVIDER_IDS)[number]

export const OPENCODE_PROVIDER_DEFAULTS: Record<OpenCodeProviderId, { name: string; api: string }> =
  {
    opencode: {
      name: 'OpenCode Zen',
      api: 'https://opencode.ai/zen/v1',
    },
    'opencode-go': {
      name: 'OpenCode Go',
      api: 'https://opencode.ai/zen/go/v1',
    },
  }

export const CATALOG_PROVIDER_IDS = ['anthropic', 'openai', 'google', 'openrouter'] as const

export const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
  opencode: OPENCODE_PROVIDER_DEFAULTS.opencode.api,
  'opencode-go': OPENCODE_PROVIDER_DEFAULTS['opencode-go'].api,
}

export function isOpenCodeProviderId(providerID: string): boolean {
  return providerID === 'opencode' || providerID.startsWith('opencode-')
}

export function isCatalogProviderId(providerID: string): boolean {
  return (CATALOG_PROVIDER_IDS as readonly string[]).includes(providerID)
}

/** Providers that connect via a stored API key / OAuth token (not a custom base URL). */
export function isCredentialProviderId(providerID: string): boolean {
  return isCatalogProviderId(providerID) || isOpenCodeProviderId(providerID)
}

export function isOpenCodeEndpoint(baseURL?: string): boolean {
  if (!baseURL?.trim()) return false
  try {
    const hostname = new URL(baseURL).hostname.toLowerCase()
    return hostname === 'opencode.ai' || hostname.endsWith('.opencode.ai')
  } catch {
    return false
  }
}

export function usesOpenCodeProtocol(providerID: string, baseURL?: string): boolean {
  return isOpenCodeProviderId(providerID) || isOpenCodeEndpoint(baseURL)
}

export function resolveProviderBaseURL(
  providerID: string,
  configured?: string,
): string | undefined {
  const trimmed = configured?.trim()
  if (trimmed) return trimmed
  return DEFAULT_PROVIDER_BASE_URLS[providerID]
}

export type ProviderRequestIdentity = {
  providerID: string
  baseURL?: string
  sessionID?: string
  requestID?: string
  /** Extra headers from user config; they win on name collisions. */
  headers?: Record<string, string>
}

/**
 * Headers OpenCode attaches to every LLM request.
 * OpenCode family: x-opencode-session + identifying User-Agent.
 * Other providers: session affinity headers + the same User-Agent.
 */
export function buildProviderRequestHeaders(
  input: ProviderRequestIdentity,
): Record<string, string> {
  const sessionID = input.sessionID?.trim()
  const requestID = input.requestID?.trim()
  const identity: Record<string, string> = usesOpenCodeProtocol(input.providerID, input.baseURL)
    ? {
        'User-Agent': CLIENT_USER_AGENT,
        'x-opencode-client': CLIENT_CHANNEL,
        ...(sessionID ? { 'x-opencode-session': sessionID } : {}),
        ...(requestID ? { 'x-opencode-request': requestID } : {}),
      }
    : {
        'User-Agent': CLIENT_USER_AGENT,
        ...(sessionID ? { 'x-session-affinity': sessionID, 'X-Session-Id': sessionID } : {}),
      }

  return { ...identity, ...input.headers }
}

export function applyRequestHeaders(headers: Headers, extra: Record<string, string>): Headers {
  for (const [name, value] of Object.entries(extra)) {
    try {
      headers.set(name, value)
    } catch {
      // Chrome forbids User-Agent on fetch Headers; the extension injects it via DNR.
    }
  }
  return headers
}

export function wrapFetchWithHeaders(
  extra: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): typeof fetch {
  return (async (input, init) => {
    const headers = new Headers(init?.headers)
    applyRequestHeaders(headers, extra)
    return fetchImpl(input, { ...init, headers })
  }) as typeof fetch
}
