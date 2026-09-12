import { describe, expect, it, vi } from 'vitest'
import {
  CLIENT_CHANNEL,
  CLIENT_USER_AGENT,
  buildProviderRequestHeaders,
  isCredentialProviderId,
  isOpenCodeEndpoint,
  isOpenCodeProviderId,
  resolveProviderBaseURL,
  usesOpenCodeProtocol,
  wrapFetchWithHeaders,
} from './identity.js'

describe('OpenCode provider identity', () => {
  it('recognizes Zen/Go provider ids', () => {
    expect(isOpenCodeProviderId('opencode')).toBe(true)
    expect(isOpenCodeProviderId('opencode-go')).toBe(true)
    expect(isOpenCodeProviderId('openai-compatible')).toBe(false)
    expect(isCredentialProviderId('opencode-go')).toBe(true)
    expect(isCredentialProviderId('openai-compatible')).toBe(false)
  })

  it('detects OpenCode endpoints even when configured as openai-compatible', () => {
    expect(isOpenCodeEndpoint('https://opencode.ai/zen/go/v1')).toBe(true)
    expect(isOpenCodeEndpoint('https://opencode.ai/zen/v1/')).toBe(true)
    expect(isOpenCodeEndpoint('http://127.0.0.1:11434/v1')).toBe(false)
    expect(usesOpenCodeProtocol('openai-compatible', 'https://opencode.ai/zen/go/v1')).toBe(true)
  })

  it('fills default Zen/Go base URLs', () => {
    expect(resolveProviderBaseURL('opencode-go')).toBe('https://opencode.ai/zen/go/v1')
    expect(resolveProviderBaseURL('opencode')).toBe('https://opencode.ai/zen/v1')
    expect(resolveProviderBaseURL('opencode-go', 'https://custom.example/v1')).toBe(
      'https://custom.example/v1',
    )
  })
})

describe('buildProviderRequestHeaders', () => {
  it('sends OpenCode Go session identity instead of a generic SDK user agent', () => {
    expect(
      buildProviderRequestHeaders({
        providerID: 'opencode-go',
        sessionID: 'sess-1',
        requestID: 'req-9',
      }),
    ).toEqual({
      'User-Agent': CLIENT_USER_AGENT,
      'x-opencode-client': CLIENT_CHANNEL,
      'x-opencode-session': 'sess-1',
      'x-opencode-request': 'req-9',
    })
    expect(CLIENT_USER_AGENT).toMatch(/^browser-agent\//)
  })

  it('treats openai-compatible + OpenCode URL as an OpenCode client', () => {
    const headers = buildProviderRequestHeaders({
      providerID: 'openai-compatible',
      baseURL: 'https://opencode.ai/zen/go/v1',
      sessionID: 'chat-42',
    })
    expect(headers['x-opencode-session']).toBe('chat-42')
    expect(headers['User-Agent']).toBe(CLIENT_USER_AGENT)
    expect(headers['x-session-affinity']).toBeUndefined()
  })

  it('uses session-affinity headers for non-OpenCode providers', () => {
    expect(
      buildProviderRequestHeaders({
        providerID: 'anthropic',
        sessionID: 'sess-2',
      }),
    ).toMatchObject({
      'User-Agent': CLIENT_USER_AGENT,
      'x-session-affinity': 'sess-2',
      'X-Session-Id': 'sess-2',
    })
  })

  it('lets user-configured headers override identity defaults', () => {
    expect(
      buildProviderRequestHeaders({
        providerID: 'opencode-go',
        sessionID: 'sess-1',
        headers: { 'x-opencode-session': 'custom', 'X-Title': 'browser-agent' },
      }),
    ).toMatchObject({
      'x-opencode-session': 'custom',
      'X-Title': 'browser-agent',
      'User-Agent': CLIENT_USER_AGENT,
    })
  })
})

describe('wrapFetchWithHeaders', () => {
  it('merges identity headers onto outbound fetch calls', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response('ok', { status: 200 })
    }) as unknown as typeof fetch

    const wrapped = wrapFetchWithHeaders(
      { 'User-Agent': CLIENT_USER_AGENT, 'x-opencode-session': 'sess-1' },
      fetchImpl,
    )
    await wrapped('https://opencode.ai/zen/go/v1/models', {
      headers: { Accept: 'application/json' },
    })

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1]
    const headers = new Headers(init?.headers)
    expect(headers.get('Accept')).toBe('application/json')
    expect(headers.get('User-Agent')).toBe(CLIENT_USER_AGENT)
    expect(headers.get('x-opencode-session')).toBe('sess-1')
  })
})
