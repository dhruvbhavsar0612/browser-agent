import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { LanguageModel } from 'ai'
import {
  buildProviderRequestHeaders,
  isOpenCodeProviderId,
  resolveProviderBaseURL,
  wrapFetchWithHeaders,
} from './identity.js'
import { resolveLanguageModelSdk, type LanguageModelSdk } from './model-api.js'

export type GetModelOptions = {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  /** Display / SDK name for openai-compatible providers (defaults to providerID) */
  name?: string
  /** Stable conversation id — sent as x-opencode-session for OpenCode endpoints. */
  sessionID?: string
  /** Per-request id — sent as x-opencode-request for OpenCode endpoints. */
  requestID?: string
  fetch?: typeof fetch
}

type ProviderSDK = {
  languageModel(modelId: string): LanguageModel
  chat?(modelId: string): LanguageModel
}

type BundledProviderLoader = (opts: GetModelOptions) => ProviderSDK

/** Local / self-hosted providers that commonly omit API keys */
const KEY_OPTIONAL_PROVIDERS = new Set(['openai-compatible', 'ollama', 'lmstudio', 'local'])

/**
 * Bundled provider factories keyed by AI SDK kind.
 *
 * IMPORTANT: use static imports (not `await import()`). Vite's dynamic-import
 * preload helper calls `document.getElementsByTagName`, which throws
 * "document is not defined" inside Chrome MV3 service workers.
 */
const SDK_LOADERS: Record<LanguageModelSdk, BundledProviderLoader> = {
  anthropic: (opts) =>
    createAnthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
      fetch: opts.fetch,
    }),

  openai: (opts) =>
    createOpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
      fetch: opts.fetch,
    }),

  google: (opts) =>
    createGoogleGenerativeAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
      fetch: opts.fetch,
    }),

  openrouter: (opts) =>
    createOpenRouter({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
      fetch: opts.fetch,
    }),

  'openai-compatible': (opts) => {
    const baseURL = opts.baseURL
    if (!baseURL) {
      throw new MissingBaseURLError(opts.name ?? 'openai-compatible')
    }
    return createOpenAICompatible({
      name: opts.name ?? 'openai-compatible',
      baseURL,
      apiKey: opts.apiKey || undefined,
      headers: opts.headers,
      fetch: opts.fetch,
    })
  },
}

/** Known provider ids used by Settings and UnknownProviderError. */
export const BUNDLED_PROVIDERS: Record<string, BundledProviderLoader> = {
  anthropic: SDK_LOADERS.anthropic,
  openai: SDK_LOADERS.openai,
  google: SDK_LOADERS.google,
  openrouter: SDK_LOADERS.openrouter,
  'openai-compatible': SDK_LOADERS['openai-compatible'],
  opencode: (opts) => SDK_LOADERS['openai-compatible'](opts),
  'opencode-go': (opts) => SDK_LOADERS['openai-compatible'](opts),
}

export class MissingApiKeyError extends Error {
  readonly providerID: string

  constructor(providerID: string) {
    super(
      `Missing API key for provider "${providerID}". Add your key in Settings → Providers, or pass options.apiKey to getModel().`,
    )
    this.name = 'MissingApiKeyError'
    this.providerID = providerID
  }
}

export class UnknownProviderError extends Error {
  readonly providerID: string

  constructor(providerID: string, known: string[]) {
    super(
      `Unknown provider "${providerID}". Use a bundled provider (${known.join(', ')}) or pass baseURL for an OpenAI-compatible endpoint.`,
    )
    this.name = 'UnknownProviderError'
    this.providerID = providerID
  }
}

export class MissingBaseURLError extends Error {
  readonly providerID: string

  constructor(providerID: string) {
    super(
      `Provider "${providerID}" requires options.baseURL (OpenAI-compatible endpoint). Example: http://127.0.0.1:11434/v1`,
    )
    this.name = 'MissingBaseURLError'
    this.providerID = providerID
  }
}

function requiresApiKey(providerID: string): boolean {
  if (KEY_OPTIONAL_PROVIDERS.has(providerID)) return false
  if (isOpenCodeProviderId(providerID)) return true
  if (!(providerID in BUNDLED_PROVIDERS)) return false
  return true
}

function assertKnownProvider(providerID: string, baseURL: string | undefined): void {
  if (providerID in BUNDLED_PROVIDERS) return
  if (baseURL) return
  throw new UnknownProviderError(providerID, Object.keys(BUNDLED_PROVIDERS))
}

/**
 * Resolve a LanguageModel for the given provider + model.
 * Does not perform network I/O — only constructs the SDK model handle.
 *
 * OpenCode Zen/Go models are routed to the native API (Responses, Messages, or
 * Chat Completions) the same way OpenCode's own provider factory does.
 */
export async function getModel(
  providerID: string,
  modelID: string,
  options: GetModelOptions = {},
): Promise<LanguageModel> {
  if (requiresApiKey(providerID) && !options.apiKey?.trim()) {
    throw new MissingApiKeyError(providerID)
  }

  const baseURL = resolveProviderBaseURL(providerID, options.baseURL)
  assertKnownProvider(providerID, baseURL)

  const sdkKind = resolveLanguageModelSdk(providerID, modelID, baseURL)
  const headers = buildProviderRequestHeaders({
    providerID,
    baseURL,
    sessionID: options.sessionID,
    requestID: options.requestID,
    headers: options.headers,
  })
  const fetchImpl = wrapFetchWithHeaders(headers, options.fetch ?? fetch)

  const loader = SDK_LOADERS[sdkKind]
  const sdk = loader({
    ...options,
    baseURL,
    name: options.name ?? providerID,
    apiKey: options.apiKey?.trim() || undefined,
    headers,
    fetch: fetchImpl,
  })

  if (typeof sdk.languageModel === 'function') {
    return sdk.languageModel(modelID)
  }
  if (typeof sdk.chat === 'function') {
    return sdk.chat(modelID)
  }

  throw new Error(`Provider "${providerID}" SDK does not expose languageModel() or chat()`)
}
