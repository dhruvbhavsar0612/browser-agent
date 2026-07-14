import { describe, expect, it } from 'vitest'
import {
  BUNDLED_PROVIDERS,
  getModel,
  MissingApiKeyError,
  MissingBaseURLError,
  UnknownProviderError,
} from './factory.js'

describe('provider factory', () => {
  it('exposes bundled provider loaders', () => {
    expect(Object.keys(BUNDLED_PROVIDERS).sort()).toEqual(
      ['anthropic', 'google', 'openai', 'openai-compatible', 'openrouter'].sort(),
    )
  })

  it('resolves openai-compatible with mock baseURL without network', async () => {
    const model = await getModel('openai-compatible', 'local-model', {
      baseURL: 'http://127.0.0.1:9/v1',
      apiKey: 'unused',
    })

    expect(model).toBeTruthy()
    expect(model).toHaveProperty('modelId', 'local-model')
    expect(model).toHaveProperty('provider', 'openai-compatible.chat')
  })

  it('avoids dynamic import() so Vite preload cannot touch document in SW', async () => {
    const { readFileSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'factory.ts'), 'utf8')
    const codeOnly = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(codeOnly).not.toMatch(/await\s+import\s*\(/)
  })

  it('resolves custom provider via openai-compatible + baseURL', async () => {
    const model = await getModel('my-vllm', 'qwen-32b', {
      baseURL: 'http://127.0.0.1:8000/v1',
    })

    expect(model).toHaveProperty('modelId', 'qwen-32b')
    expect(model).toHaveProperty('provider', 'my-vllm.chat')
  })

  it('resolves ollama with default local baseURL and no api key', async () => {
    const model = await getModel('ollama', 'llama3.2')
    expect(model).toHaveProperty('modelId', 'llama3.2')
  })

  it('throws actionable MissingApiKeyError for anthropic', async () => {
    await expect(getModel('anthropic', 'claude-sonnet-4-5')).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof MissingApiKeyError &&
        err.providerID === 'anthropic' &&
        /Missing API key/.test(err.message) &&
        /Settings → Providers/.test(err.message),
    )
  })

  it('throws actionable MissingApiKeyError for openai', async () => {
    await expect(getModel('openai', 'gpt-4.1')).rejects.toBeInstanceOf(MissingApiKeyError)
    await expect(getModel('openai', 'gpt-4.1', { apiKey: '   ' })).rejects.toBeInstanceOf(
      MissingApiKeyError,
    )
  })

  it('throws MissingApiKeyError for openrouter and google', async () => {
    await expect(getModel('openrouter', 'openai/gpt-4o')).rejects.toBeInstanceOf(MissingApiKeyError)
    await expect(getModel('google', 'gemini-2.5-flash')).rejects.toBeInstanceOf(MissingApiKeyError)
  })

  it('instantiates cloud providers when apiKey is provided (no network)', async () => {
    const anthropic = await getModel('anthropic', 'claude-sonnet-4-5', {
      apiKey: 'sk-ant-test',
    })
    expect(anthropic).toHaveProperty('modelId', 'claude-sonnet-4-5')

    const openai = await getModel('openai', 'gpt-4.1', { apiKey: 'sk-test' })
    expect(openai).toHaveProperty('modelId', 'gpt-4.1')

    const google = await getModel('google', 'gemini-2.5-flash', { apiKey: 'goog-test' })
    expect(google).toHaveProperty('modelId', 'gemini-2.5-flash')

    const openrouter = await getModel('openrouter', 'openai/gpt-4o', {
      apiKey: 'or-test',
    })
    expect(openrouter).toHaveProperty('modelId', 'openai/gpt-4o')
  })

  it('requires baseURL for openai-compatible', async () => {
    await expect(getModel('openai-compatible', 'x')).rejects.toBeInstanceOf(MissingBaseURLError)
  })

  it('rejects unknown providers without baseURL', async () => {
    await expect(getModel('nope', 'model')).rejects.toBeInstanceOf(UnknownProviderError)
  })
})
