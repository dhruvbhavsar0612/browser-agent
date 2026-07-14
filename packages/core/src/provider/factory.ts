import type { LanguageModel } from 'ai'

export type GetModelOptions = {
  apiKey?: string
  baseURL?: string
  headers?: Record<string, string>
  /** Display / SDK name for openai-compatible providers (defaults to providerID) */
  name?: string
}

type ProviderSDK = {
  languageModel(modelId: string): LanguageModel
  chat?(modelId: string): LanguageModel
}

type BundledProviderLoader = (opts: GetModelOptions) => Promise<ProviderSDK>

/** Local / self-hosted providers that commonly omit API keys */
const KEY_OPTIONAL_PROVIDERS = new Set([
  'openai-compatible',
  'ollama',
  'lmstudio',
  'local',
])

const DEFAULT_BASE_URLS: Record<string, string> = {
  ollama: 'http://127.0.0.1:11434/v1',
  lmstudio: 'http://127.0.0.1:1234/v1',
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

/**
 * Lazy, browser-safe provider loaders keyed by provider ID.
 * Dynamic imports keep unused providers out of the initial extension bundle when tree-shaken.
 */
export const BUNDLED_PROVIDERS: Record<string, BundledProviderLoader> = {
  anthropic: async (opts) => {
    const { createAnthropic } = await import('@ai-sdk/anthropic')
    return createAnthropic({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    })
  },

  openai: async (opts) => {
    const { createOpenAI } = await import('@ai-sdk/openai')
    return createOpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    })
  },

  google: async (opts) => {
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    return createGoogleGenerativeAI({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    })
  },

  openrouter: async (opts) => {
    const { createOpenRouter } = await import('@openrouter/ai-sdk-provider')
    return createOpenRouter({
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      headers: opts.headers,
    })
  },

  'openai-compatible': async (opts) => {
    const baseURL = opts.baseURL
    if (!baseURL) {
      throw new MissingBaseURLError(opts.name ?? 'openai-compatible')
    }
    const { createOpenAICompatible } = await import('@ai-sdk/openai-compatible')
    return createOpenAICompatible({
      name: opts.name ?? 'openai-compatible',
      baseURL,
      apiKey: opts.apiKey || undefined,
      headers: opts.headers,
    })
  },
}

function requiresApiKey(providerID: string): boolean {
  if (KEY_OPTIONAL_PROVIDERS.has(providerID)) return false
  // Custom IDs that fall through to openai-compatible also allow empty keys
  if (!(providerID in BUNDLED_PROVIDERS)) return false
  return true
}

function resolveLoader(providerID: string, options: GetModelOptions): BundledProviderLoader {
  const bundled = BUNDLED_PROVIDERS[providerID]
  if (bundled) return bundled

  const baseURL = options.baseURL ?? DEFAULT_BASE_URLS[providerID]
  if (baseURL) {
    return BUNDLED_PROVIDERS['openai-compatible']!
  }

  throw new UnknownProviderError(providerID, Object.keys(BUNDLED_PROVIDERS))
}

/**
 * Resolve a LanguageModel for the given provider + model.
 * Does not perform network I/O — only constructs the SDK model handle.
 */
export async function getModel(
  providerID: string,
  modelID: string,
  options: GetModelOptions = {},
): Promise<LanguageModel> {
  if (requiresApiKey(providerID) && !options.apiKey?.trim()) {
    throw new MissingApiKeyError(providerID)
  }

  const baseURL = options.baseURL ?? DEFAULT_BASE_URLS[providerID]
  const loader = resolveLoader(providerID, { ...options, baseURL })

  const sdk = await loader({
    ...options,
    baseURL,
    name: options.name ?? providerID,
    apiKey: options.apiKey?.trim() || undefined,
  })

  if (typeof sdk.languageModel === 'function') {
    return sdk.languageModel(modelID)
  }
  if (typeof sdk.chat === 'function') {
    return sdk.chat(modelID)
  }

  throw new Error(`Provider "${providerID}" SDK does not expose languageModel() or chat()`)
}
