#!/usr/bin/env node
/**
 * Regenerate packages/core/src/provider/models-dev.snapshot.json from
 * https://models.dev/api.json — slim fields only, chat-oriented models.
 *
 * Usage: node scripts/update-models-snapshot.mjs
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MODELS_DEV_URL = 'https://models.dev/api.json'
const PROVIDERS = ['anthropic', 'openai', 'google', 'openrouter']
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'packages/core/src/provider/models-dev.snapshot.json')

function slimModel(id, m) {
  const out = {
    id: m.id || id,
    name: m.name,
    tool_call: Boolean(m.tool_call),
  }
  if (m.modalities?.input?.length) {
    out.modalities = { input: [...m.modalities.input] }
  }
  if (m.limit?.context != null) {
    out.limit = { context: m.limit.context }
  }
  return out
}

function includeModel(id, m) {
  const name = `${id} ${m.name || ''}`.toLowerCase()
  if (/embed|tts|whisper|dall-e|imagen|moderation|transcri/.test(name)) return false
  const input = m.modalities?.input
  if (Array.isArray(input) && input.length > 0 && !input.includes('text')) return false
  return true
}

const res = await fetch(MODELS_DEV_URL)
if (!res.ok) {
  console.error(`models.dev HTTP ${res.status}`)
  process.exit(1)
}
const catalog = await res.json()

const out = {}
for (const id of PROVIDERS) {
  const p = catalog[id]
  if (!p) {
    console.error(`Missing provider "${id}" in models.dev`)
    process.exit(1)
  }
  const models = {}
  for (const [mid, m] of Object.entries(p.models || {})) {
    if (!includeModel(mid, m)) continue
    models[mid] = slimModel(mid, m)
  }
  out[id] = {
    name: id === 'google' ? 'Google AI Studio' : p.name,
    models,
  }
  console.log(`${id}: ${Object.keys(models).length} models`)
}

// models.dev has no ollama provider — keep a small local stub
out.ollama = {
  name: 'Ollama',
  models: {
    'llama3.2': {
      id: 'llama3.2',
      name: 'Llama 3.2',
      tool_call: true,
      modalities: { input: ['text'] },
      limit: { context: 128000 },
    },
    'llama3.3': {
      id: 'llama3.3',
      name: 'Llama 3.3',
      tool_call: true,
      modalities: { input: ['text'] },
      limit: { context: 128000 },
    },
    'qwen2.5-coder': {
      id: 'qwen2.5-coder',
      name: 'Qwen2.5 Coder',
      tool_call: true,
      modalities: { input: ['text'] },
      limit: { context: 32768 },
    },
  },
}

writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`)
console.log(`wrote ${OUT}`)
