import { describe, expect, it } from 'vitest'
import { getModel } from '../provider/factory.js'
import { filterToolsByPermission, listTools, toAiSdkTools } from '../tools/index.js'
import { fromConfig } from '../permission/index.js'
import { runAgentLoop } from './loop.js'
import type { StreamEvent } from '../messaging/index.js'

const KEY = process.env.LIVE_KEY
const BASE = 'https://opencode.ai/zen/go/v1'
const MODEL = process.env.LIVE_MODEL ?? 'minimax-m3'

describe.runIf(Boolean(KEY))('live agent loop', () => {
  it(
    'calls echo tool via OpenCode Zen',
    async () => {
      const events: StreamEvent[] = []
      const model = await getModel('openai-compatible', MODEL, {
        apiKey: KEY,
        baseURL: BASE,
      })
      const ruleset = fromConfig({ echo: 'allow', get_time: 'allow', '*': 'ask' })
      const tools = toAiSdkTools(filterToolsByPermission(listTools(), ruleset), {
        sessionId: 'live-test',
        ask: async () => undefined,
      })

      const result = await runAgentLoop({
        model,
        messages: [
          {
            role: 'user',
            content:
              'You must call the echo tool with text exactly "hello sprint-2". Do not skip the tool. After the tool result, reply with one short sentence.',
          },
        ],
        system:
          'You are a test agent. Always use the echo tool when asked to echo. Tools available: echo, get_time.',
        tools,
        steps: 5,
        onEvent: (e) => events.push(e),
      })

      console.log(
        'events:',
        events.map((e) =>
          e.kind === 'text-delta'
            ? { kind: e.kind, text: e.text.slice(0, 80) }
            : e,
        ),
      )
      console.log('finish:', result)

      const toolCalls = events.filter((e) => e.kind === 'tool-call')
      const toolResults = events.filter((e) => e.kind === 'tool-result')
      expect(toolCalls.length).toBeGreaterThan(0)
      expect(toolCalls.some((e) => e.kind === 'tool-call' && e.toolName === 'echo')).toBe(true)
      expect(toolResults.length).toBeGreaterThan(0)
      const echoed = toolResults.find(
        (e) =>
          e.kind === 'tool-result' &&
          JSON.stringify(e.result).includes('hello sprint-2'),
      )
      expect(echoed).toBeTruthy()
    },
    90_000,
  )

  it(
    'streams plain text without tools when not needed',
    async () => {
      const events: StreamEvent[] = []
      const model = await getModel('openai-compatible', MODEL, {
        apiKey: KEY,
        baseURL: BASE,
      })
      await runAgentLoop({
        model,
        messages: [{ role: 'user', content: 'Reply with exactly the word: pong' }],
        steps: 2,
        onEvent: (e) => events.push(e),
      })
      const text = events
        .filter((e) => e.kind === 'text-delta')
        .map((e) => (e.kind === 'text-delta' ? e.text : ''))
        .join('')
      console.log('plain text:', JSON.stringify(text))
      expect(text.toLowerCase()).toContain('pong')
      expect(events.some((e) => e.kind === 'done')).toBe(true)
    },
    60_000,
  )
})
