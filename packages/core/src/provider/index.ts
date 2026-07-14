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

/** Placeholder — DHR-47 implements AI SDK factory */
export async function getModel(_providerID: string, _modelID: string): Promise<never> {
  throw new Error('Provider factory not implemented yet (DHR-47)')
}
