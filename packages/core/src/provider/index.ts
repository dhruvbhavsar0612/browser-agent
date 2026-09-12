export interface ModelInfo {
  id: string
  name: string
  providerID: string
  toolCall: boolean
  vision: boolean
  context: number
}

export interface ProviderInfo {
  id: string
  name: string
  models: ModelInfo[]
}

export {
  ModelsDevService,
  MODELS_DEV_URL,
  MODELS_CACHE_TTL_MS,
  getBundledSnapshot,
  catalogToProviders,
} from './models-dev.js'
export type {
  ModelsCatalog,
  ModelsCacheEntry,
  ProviderModelsCacheEntry,
  ProviderDiscoveryResult,
  ModelDiscoverySource,
} from './models-dev.js'

export {
  BUNDLED_PROVIDERS,
  getModel,
  MissingApiKeyError,
  MissingBaseURLError,
  UnknownProviderError,
} from './factory.js'
export type { GetModelOptions } from './factory.js'

export {
  fetchOpenAICompatibleModels,
  mergeCompatibleProvider,
  modelsEndpointUrl,
  toOpenAICompatibleProvider,
} from './openai-compatible-models.js'
export type { FetchOpenAICompatibleModelsOptions } from './openai-compatible-models.js'

export {
  CATALOG_PROVIDER_IDS,
  CLIENT_CHANNEL,
  CLIENT_ID,
  CLIENT_USER_AGENT,
  CLIENT_VERSION,
  DEFAULT_PROVIDER_BASE_URLS,
  OPENCODE_PROVIDER_DEFAULTS,
  OPENCODE_PROVIDER_IDS,
  applyRequestHeaders,
  buildProviderRequestHeaders,
  isCatalogProviderId,
  isCredentialProviderId,
  isOpenCodeEndpoint,
  isOpenCodeProviderId,
  resolveProviderBaseURL,
  usesOpenCodeProtocol,
  wrapFetchWithHeaders,
} from './identity.js'
export type { OpenCodeProviderId, ProviderRequestIdentity } from './identity.js'

export { resolveLanguageModelSdk, resolveOpenCodeModelSdk } from './model-api.js'
export type { LanguageModelSdk } from './model-api.js'
