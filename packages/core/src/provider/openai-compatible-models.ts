import { z } from 'zod'
import type { ModelInfo, ProviderInfo } from './index.js'

const OpenAIModelSchema = z
  .object({
    id: z.string().min(1),
    object: z.string().optional(),
    owned_by: z.string().optional(),
    created: z.number().optional(),
  })
  .passthrough()

const OpenAIModelsListSchema = z.object({
  object: z.string().optional(),
  data: z.array(OpenAIModelSchema),
})

export type FetchOpenAICompatibleModelsOptions = {
  baseURL: string
  apiKey?: string
  headers?: Record<string, string>
  /** Defaults to global fetch */
  fetchImpl?: typeof fetch
  /** Provider id used in ModelInfo / picker (default: openai-compatible) */
  providerID?: string
  /** Display name in the picker (default: OpenAI-compatible) */
  name?: string
}

/** Join baseURL + /models without duplicating slashes. */
export function modelsEndpointUrl(baseURL: string): string {
  const trimmed = baseURL.trim().replace(/\/+$/, '')
  if (!trimmed) {
    throw new Error('baseURL is required')
  }
  return `${trimmed}/models`
}

export function toOpenAICompatibleProvider(
  models: Array<{ id: string; owned_by?: string }>,
  opts?: { providerID?: string; name?: string },
): ProviderInfo {
  const providerID = opts?.providerID ?? 'openai-compatible'
  const modelInfos: ModelInfo[] = models.map((model) => ({
    id: model.id,
    name: model.id,
    providerID,
    toolCall: false,
    vision: false,
    context: 0,
  }))
  modelInfos.sort((a, b) => a.name.localeCompare(b.name))
  return {
    id: providerID,
    name: opts?.name ?? 'OpenAI-compatible',
    models: modelInfos,
  }
}

/**
 * GET {baseURL}/models (OpenAI-compatible list).
 * Used for custom endpoints like https://opencode.ai/zen/go/v1
 */
export async function fetchOpenAICompatibleModels(
  options: FetchOpenAICompatibleModelsOptions,
): Promise<ProviderInfo> {
  const url = modelsEndpointUrl(options.baseURL)
  const fetchImpl = options.fetchImpl ?? fetch
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...options.headers,
  }
  if (options.apiKey?.trim()) {
    headers.Authorization = `Bearer ${options.apiKey.trim()}`
  }

  const res = await fetchImpl(url, { headers })
  if (!res.ok) {
    throw new Error(`Failed to list models from ${url} (HTTP ${res.status})`)
  }

  const json: unknown = await res.json()
  const parsed = OpenAIModelsListSchema.safeParse(json)
  if (!parsed.success) {
    throw new Error(`Unexpected /models response from ${url}`)
  }

  return toOpenAICompatibleProvider(parsed.data.data, {
    providerID: options.providerID,
    name: options.name,
  })
}

/** Merge remote openai-compatible models into a models.dev-style provider list. */
export function mergeCompatibleProvider(
  providers: ProviderInfo[],
  compatible: ProviderInfo | null,
): ProviderInfo[] {
  if (!compatible || compatible.models.length === 0) {
    return providers.filter((p) => p.id !== 'openai-compatible' || p.models.length > 0)
  }
  const without = providers.filter((p) => p.id !== compatible.id)
  return [compatible, ...without]
}
