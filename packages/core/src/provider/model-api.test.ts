import { describe, expect, it } from 'vitest'
import { resolveLanguageModelSdk, resolveOpenCodeModelSdk } from './model-api.js'

describe('resolveOpenCodeModelSdk', () => {
  it('routes Responses-API models to @ai-sdk/openai', () => {
    expect(resolveOpenCodeModelSdk('grok-4.6')).toBe('openai')
    expect(resolveOpenCodeModelSdk('gpt-5.6-luna')).toBe('openai')
    expect(resolveOpenCodeModelSdk('muse-spark-1.3-contributor')).toBe('openai')
  })

  it('routes Messages-API models to @ai-sdk/anthropic', () => {
    expect(resolveOpenCodeModelSdk('minimax-m3')).toBe('anthropic')
    expect(resolveOpenCodeModelSdk('minimax-m2.7')).toBe('anthropic')
    expect(resolveOpenCodeModelSdk('qwen3.8-max')).toBe('anthropic')
    expect(resolveOpenCodeModelSdk('qwen3.7-plus')).toBe('anthropic')
  })

  it('routes Chat Completions models to openai-compatible', () => {
    expect(resolveOpenCodeModelSdk('glm-5.3-flash')).toBe('openai-compatible')
    expect(resolveOpenCodeModelSdk('kimi-k3')).toBe('openai-compatible')
    expect(resolveOpenCodeModelSdk('deepseek-v4-flash')).toBe('openai-compatible')
    expect(resolveOpenCodeModelSdk('mimo-v2.5')).toBe('openai-compatible')
    expect(resolveOpenCodeModelSdk('hy3')).toBe('openai-compatible')
    expect(resolveOpenCodeModelSdk('longcat-2.0')).toBe('openai-compatible')
  })
})

describe('resolveLanguageModelSdk', () => {
  it('keeps bundled cloud providers on their native SDKs', () => {
    expect(resolveLanguageModelSdk('anthropic', 'claude-sonnet-4-5')).toBe('anthropic')
    expect(resolveLanguageModelSdk('openai', 'gpt-4.1')).toBe('openai')
    expect(resolveLanguageModelSdk('google', 'gemini-2.5-flash')).toBe('google')
    expect(resolveLanguageModelSdk('openrouter', 'openai/gpt-4o')).toBe('openrouter')
  })

  it('routes OpenCode Go and openai-compatible Zen URLs by model family', () => {
    expect(resolveLanguageModelSdk('opencode-go', 'minimax-m3')).toBe('anthropic')
    expect(resolveLanguageModelSdk('opencode', 'kimi-k3')).toBe('openai-compatible')
    expect(
      resolveLanguageModelSdk('openai-compatible', 'minimax-m3', 'https://opencode.ai/zen/go/v1'),
    ).toBe('anthropic')
    expect(
      resolveLanguageModelSdk('openai-compatible', 'llama3.2', 'http://127.0.0.1:11434/v1'),
    ).toBe('openai-compatible')
  })
})
