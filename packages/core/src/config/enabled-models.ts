import type { ModelInfo, ProviderInfo } from '../provider/index.js'
import { isModelEnabled, type AppConfig } from './schema.js'

export type EnabledModelGroup = {
  provider: ProviderInfo
  models: ModelInfo[]
}

export type ProviderConnection = {
  hasCredential: boolean
  /** True when a non-catalog provider has a configured base URL / api. */
  hasEndpoint: boolean
}

const CATALOG_PROVIDER_IDS = new Set(['anthropic', 'openai', 'google', 'openrouter'])

export function isCatalogProvider(providerID: string): boolean {
  return CATALOG_PROVIDER_IDS.has(providerID)
}

/** Whether a provider is connected enough to expose models in pickers. */
export function isProviderConnected(
  providerID: string,
  config: AppConfig,
  connection?: ProviderConnection,
): boolean {
  const providerConfig = config.provider[providerID]
  if (!providerConfig?.enabled) return false

  if (isCatalogProvider(providerID)) {
    return connection?.hasCredential === true
  }

  if (connection?.hasEndpoint) return true
  return Boolean(
    providerConfig.api ??
      (providerConfig.options as { baseURL?: string } | undefined)?.baseURL,
  )
}

/**
 * Build picker groups from config-enabled models.
 * Discovery cache enriches names/capabilities; config remains the source of truth
 * so enabling a model always surfaces it in Default model + Chat pickers.
 */
export function listEnabledModelGroups(
  config: AppConfig,
  discovered: ProviderInfo[],
  opts?: {
    /** providerID → connection flags (credentials / endpoint) */
    connections?: Record<string, ProviderConnection>
  },
): EnabledModelGroup[] {
  const discoveredById = new Map(discovered.map((provider) => [provider.id, provider]))
  const groups: EnabledModelGroup[] = []

  for (const [providerID, providerConfig] of Object.entries(config.provider)) {
    if (!providerConfig?.enabled) continue

    const discoveredProvider = discoveredById.get(providerID)
    const connected =
      Boolean(discoveredProvider) ||
      isProviderConnected(providerID, config, opts?.connections?.[providerID])
    if (!connected) continue

    const models: ModelInfo[] = []

    for (const [modelID, modelConfig] of Object.entries(providerConfig.models ?? {})) {
      if (!isModelEnabled(config, providerID, modelID)) continue
      const discoveredModel = discoveredProvider?.models.find((model) => model.id === modelID)
      models.push(
        discoveredModel ?? {
          id: modelID,
          name: modelConfig.name ?? modelID,
          providerID,
          toolCall: modelConfig.tool_call ?? false,
          vision: false,
          context: 0,
        },
      )
    }

    if (models.length === 0) continue
    models.sort((a, b) => a.name.localeCompare(b.name))
    groups.push({
      provider: {
        id: providerID,
        name: discoveredProvider?.name ?? providerConfig.name ?? providerID,
        models: discoveredProvider?.models ?? models,
      },
      models,
    })
  }

  groups.sort((a, b) => a.provider.name.localeCompare(b.provider.name))
  return groups
}

/** Synthesize a ProviderInfo from enabled config models when discovery cache is missing. */
export function providerInfoFromEnabledConfig(
  providerID: string,
  config: AppConfig,
): ProviderInfo | null {
  const providerConfig = config.provider[providerID]
  if (!providerConfig?.enabled) return null
  const models: ModelInfo[] = Object.entries(providerConfig.models ?? {})
    .filter(([, model]) => model.enabled)
    .map(([id, model]) => ({
      id,
      name: model.name ?? id,
      providerID,
      toolCall: model.tool_call ?? false,
      vision: false,
      context: 0,
    }))
  if (models.length === 0) return null
  models.sort((a, b) => a.name.localeCompare(b.name))
  return {
    id: providerID,
    name: providerConfig.name ?? providerID,
    models,
  }
}
