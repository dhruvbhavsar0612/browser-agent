import {
  ConfigService,
  CredentialVault,
  ModelsDevService,
  createResponse,
  generateText,
  getModel,
  type Envelope,
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
): Promise<{ apiKey?: string; baseURL?: string; name?: string }> {
  const cred = await vault.get(providerID)
  const cfg = await config.get()
  const providerCfg = cfg.provider[providerID]
  const options = providerCfg?.options as { baseURL?: string } | undefined

  return {
    apiKey: cred?.secret,
    baseURL: providerCfg?.api ?? options?.baseURL,
    name: providerCfg?.name ?? providerID,
  }
}

export async function runModelTest(
  providerID: string,
  modelID: string,
  deps: { vault: CredentialVault; config: ConfigService },
): Promise<{ ok: boolean; text?: string; error?: string }> {
  try {
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
      const payload = (message.payload ?? {}) as { providerId?: string }
      const providerId = payload.providerId?.trim()
      if (!providerId) {
        throw new Error('providerId is required')
      }
      await vault.delete(providerId)
      const entries = await vault.list()
      return createResponse(message, 'vault.delete', { ok: true, entries })
    })
    .on('vault.clear', async (message) => {
      await vault.clear()
      return createResponse(message, 'vault.clear', { ok: true, entries: [] })
    })
    .on('models.list', async (message) => {
      const payload = (message.payload ?? {}) as { forceRefresh?: boolean }
      const providers = await models.listProviders({ forceRefresh: payload.forceRefresh })
      return createResponse(message, 'models.list', { providers })
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
