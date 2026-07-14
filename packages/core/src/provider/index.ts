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

/** Placeholder — DHR-44 implements models.dev fetch/cache */
export function listProviders(): ProviderInfo[] {
  return []
}

/** Placeholder — DHR-47 implements AI SDK factory */
export async function getModel(
  _providerID: string,
  _modelID: string,
): Promise<never> {
  throw new Error('Provider factory not implemented yet (DHR-47)')
}
