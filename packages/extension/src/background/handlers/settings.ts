import {
  ConfigService,
  CredentialVault,
  ModelsDevService,
  createResponse,
  credentialSecretToApiKey,
  fetchOpenAICompatibleModels,
  generateText,
  getModel,
  isModelEnabled,
  type Envelope,
  type ModelDiscoverySource,
  type ProviderDiscoveryResult,
  type ProviderInfo,
  type VaultListEntry,
} from '@browser-agent/core'
import type { MessageBus } from '../bus.js'

export const SETTINGS_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'openrouter',
  'openai-compatible',
] as const

export type SettingsProviderId = (typeof SETTINGS_PROVIDERS)[number]

const MODELS_DEV_PROVIDERS = new Set<string>(['anthropic', 'openai', 'google', 'openrouter'])

export type DiscoveryStatus = {
  fetchedAt: number
  source: ModelDiscoverySource
  offline: boolean
  error?: string
}

export function parseModelRef(model: string): { providerID: string; modelID: string } {
  const slash = model.indexOf('/')
  if (slash <= 0 || slash === model.length - 1) {
    throw new Error('Invalid model format; expected providerID/modelID')
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  }
}

export function formatModelRef(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`
}

async function resolveModelOptions(
  providerID: string,
  vault: CredentialVault,
  config: ConfigService,
): Promise<{ apiKey?: string; baseURL?: string; name?: string; headers?: Record<string, string> }> {
  const cred = await vault.get(providerID)
  const cfg = await config.get()
  const providerCfg = cfg.provider[providerID]
  const options = providerCfg?.options as { baseURL?: string } | undefined

  return {
    apiKey: cred ? credentialSecretToApiKey(cred.secret, cred.type) : undefined,
    baseURL: providerCfg?.api ?? options?.baseURL,
    name: providerCfg?.name ?? providerID,
    headers: providerCfg?.options?.headers,
  }
}

export async function loadCompatibleModels(deps: {
  models: ModelsDevService
  vault: CredentialVault
  config: ConfigService
  providerID?: string
  forceRefresh?: boolean
}): Promise<ProviderDiscoveryResult> {
  const providerID = deps.providerID ?? 'openai-compatible'
  const cached = await deps.models.getCachedProvider(providerID)
  if (cached && !deps.forceRefresh) return cached
  const options = await resolveModelOptions(providerID, deps.vault, deps.config)
  const baseURL = options.baseURL?.trim()
  if (!baseURL) {
    throw new Error(`Provider "${providerID}" needs a base URL before discovery`)
  }

  try {
    const provider = await fetchOpenAICompatibleModels({
      baseURL,
      apiKey: options.apiKey,
      headers: options.headers,
      providerID,
      name: options.name ?? providerID,
    })
    const fetchedAt = Date.now()
    await deps.models.cacheProvider(provider, { fetchedAt, source: 'network' })
    return { provider, fetchedAt, source: 'network', offline: false }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (cached) {
      return {
        ...cached,
        source: 'cache',
        offline: true,
        error,
      }
    }
    throw err
  }
}

export async function listConnectedProviders(deps: {
  models: ModelsDevService
  vault: CredentialVault
  config: ConfigService
}): Promise<{ providers: ProviderInfo[]; discovery: Record<string, DiscoveryStatus> }> {
  const config = await deps.config.get()
  const credentials = await deps.vault.list()
  const credentialProviders = new Set(credentials.map((entry) => entry.providerId))
  const providers: ProviderInfo[] = []
  const discovery: Record<string, DiscoveryStatus> = {}

  for (const [providerID, providerConfig] of Object.entries(config.provider)) {
    if (!providerConfig.enabled) continue
    const connected = MODELS_DEV_PROVIDERS.has(providerID)
      ? credentialProviders.has(providerID)
      : Boolean(
          providerConfig.api ??
          (providerConfig.options as { baseURL?: string } | undefined)?.baseURL,
        )
    if (!connected) continue
    const cached = await deps.models.getCachedProvider(providerID)
    if (!cached) continue
    providers.push(cached.provider)
    discovery[providerID] = {
      fetchedAt: cached.fetchedAt,
      source: cached.source,
      offline: cached.offline,
      error: cached.error,
    }
  }

  return { providers, discovery }
}

export async function discoverProviderModels(
  providerID: string,
  deps: {
    models: ModelsDevService
    vault: CredentialVault
    config: ConfigService
  },
  opts?: { forceRefresh?: boolean },
): Promise<ProviderDiscoveryResult> {
  const config = await deps.config.get()
  const providerConfig = config.provider[providerID]
  if (!providerConfig?.enabled) {
    throw new Error(`Enable provider "${providerID}" before discovering models`)
  }

  if (MODELS_DEV_PROVIDERS.has(providerID)) {
    if (!(await deps.vault.get(providerID))) {
      throw new Error(`Connect provider "${providerID}" before discovering models`)
    }
    return deps.models.discoverProvider(providerID, {
      forceRefresh: opts?.forceRefresh,
    })
  }

  return loadCompatibleModels({
    ...deps,
    providerID,
    forceRefresh: opts?.forceRefresh,
  })
}

export async function runModelTest(
  providerID: string,
  modelID: string,
  deps: { vault: CredentialVault; config: ConfigService },
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
    const appConfig = await deps.config.get()
    if (!isModelEnabled(appConfig, providerID, modelID)) {
      throw new Error(`Model "${providerID}/${modelID}" is not enabled`)
    }
    const options = await resolveModelOptions(providerID, deps.vault, deps.config)
    const model = await getModel(providerID, modelID, options)
    const result = await generateText({
      model,
      prompt: 'ping',
      maxOutputTokens: 16,
    })
    const text = result.text.trim()
    return { ok: true, text: text || '(empty response)' }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export interface SettingsHandlerDeps {
  vault: CredentialVault
  models: ModelsDevService
  config: ConfigService
}

export function registerSettingsHandlers(bus: MessageBus, deps: SettingsHandlerDeps): void {
  const { vault, models, config } = deps

  bus
    .on('vault.set', async (message) => {
      const payload = (message.payload ?? {}) as {
        providerId?: string
        secret?: string
        type?: 'api' | 'oauth'
      }
      const providerId = payload.providerId?.trim()
      const secret = payload.secret?.trim()
      if (!providerId || !secret) {
        throw new Error('providerId and secret are required')
      }
      await vault.set(providerId, secret, payload.type ?? 'api')
      const entries = await vault.list()
      return createResponse(message, 'vault.set', { ok: true, entries })
    })
    .on('vault.list', async (message) => {
      const entries: VaultListEntry[] = await vault.list()
      return createResponse(message, 'vault.list', { entries })
    })
    .on('vault.delete', async (message) => {
      const payload = (message.payload ?? {}) as {
        providerId?: string
        type?: 'api' | 'oauth'
      }
      const providerId = payload.providerId?.trim()
      if (!providerId) {
        throw new Error('providerId is required')
      }
      await vault.delete(providerId, payload.type)
      const entries = await vault.list()
      return createResponse(message, 'vault.delete', { ok: true, entries })
    })
    .on('vault.clear', async (message) => {
      await vault.clear()
      return createResponse(message, 'vault.clear', { ok: true, entries: [] })
    })
    .on('models.list', async (message) => {
      const { providers, discovery } = await listConnectedProviders({ models, vault, config })
      return createResponse(message, 'models.list', {
        providers,
        discovery,
      })
    })
    .on('models.discover', async (message) => {
      const payload = (message.payload ?? {}) as {
        providerId?: string
        forceRefresh?: boolean
      }
      const providerId = payload.providerId?.trim()
      if (!providerId) throw new Error('providerId is required')
      const result = await discoverProviderModels(
        providerId,
        { models, vault, config },
        { forceRefresh: payload.forceRefresh ?? true },
      )
      return createResponse(message, 'models.discover', result)
    })
    .on('model.test', async (message) => {
      const payload = (message.payload ?? {}) as {
        providerID?: string
        modelID?: string
        model?: string
      }

      let providerID = payload.providerID?.trim()
      let modelID = payload.modelID?.trim()

      if (payload.model?.trim()) {
        ;({ providerID, modelID } = parseModelRef(payload.model.trim()))
      }

      if (!providerID || !modelID) {
        const cfg = await config.get()
        if (!cfg.model?.trim()) {
          throw new Error('No model selected; set a default model or pass providerID/modelID')
        }
        ;({ providerID, modelID } = parseModelRef(cfg.model.trim()))
      }

      const result = await runModelTest(providerID, modelID, { vault, config })
      return createResponse(message, 'model.test', result)
    })
}

/** @internal test helper — invoke a registered handler without chrome.runtime */
export async function dispatchSettingsMessage(
  bus: MessageBus,
  message: Envelope,
): Promise<Envelope> {
  return bus.dispatch(message, {} as chrome.runtime.MessageSender)
}
