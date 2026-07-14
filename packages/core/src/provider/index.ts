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
export type { ModelsCatalog, ModelsCacheEntry } from './models-dev.js'

export {
  BUNDLED_PROVIDERS,
  getModel,
  MissingApiKeyError,
  MissingBaseURLError,
  UnknownProviderError,
} from './factory.js'
export type { GetModelOptions } from './factory.js'
