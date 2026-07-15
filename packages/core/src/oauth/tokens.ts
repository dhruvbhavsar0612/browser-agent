import { z } from 'zod'

/** Encrypted OAuth payload stored in the vault (`type: 'oauth'`). */
export const OAuthTokenPayload = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
  /** OpenAI ChatGPT account id when present */
  accountId: z.string().optional(),
  /** Provider-specific extras (plan type, email, etc.) */
  meta: z.record(z.string(), z.unknown()).optional(),
})
export type OAuthTokenPayload = z.infer<typeof OAuthTokenPayload>

export function serializeOAuthPayload(payload: OAuthTokenPayload): string {
  return JSON.stringify(OAuthTokenPayload.parse(payload))
}

export function parseOAuthPayload(secret: string): OAuthTokenPayload | null {
  const trimmed = secret.trim()
  if (!trimmed.startsWith('{')) {
    // Plain API key stored under oauth type (e.g. Anthropic create_api_key result)
    return { accessToken: trimmed }
  }
  try {
    return OAuthTokenPayload.parse(JSON.parse(trimmed))
  } catch {
    return null
  }
}

/** Prefer OAuth access token / exchanged key; fall back to raw API secret. */
export function credentialSecretToApiKey(secret: string, type: 'api' | 'oauth'): string {
  if (type === 'api') return secret
  const payload = parseOAuthPayload(secret)
  return payload?.accessToken ?? secret
}

export function isOAuthExpired(payload: OAuthTokenPayload, bufferMs = 60_000): boolean {
  if (!payload.expiresAt) return false
  return Date.now() >= payload.expiresAt - bufferMs
}
