import { describe, expect, it } from 'vitest'
import { getModel } from '../provider/factory.js'
import {
  filterToolsByPermission,
  listTools,
  toAiSdkTools,
  type BrowserBridge,
  type TabInfo,
} from '../tools/index.js'
import { fromConfig } from '../permission/index.js'
import { DEFAULT_CONFIG } from '../config/schema.js'
import { runAgentLoop } from './loop.js'
import type { StreamEvent } from '../messaging/index.js'

const KEY = process.env.LIVE_KEY
const BASE = 'https://opencode.ai/zen/go/v1'
const MODEL = process.env.LIVE_MODEL ?? 'minimax-m3'

const FIXTURE_A11Y = `document "Example Domain" [ref_1]
 heading "Example Domain" [ref_2]
 text "This domain is for use in documentation examples" [ref_3]
 link "More information" [ref_4] href="https://iana.org/domains/example"
 button "Learn more" [ref_5]
`

function createLiveFakeBridge(): BrowserBridge {
  const tabs: TabInfo[] = [
    {
      id: 42,
      title: 'Example Domain',
      url: 'https://example.com/',
      active: true,
      windowId: 1,
    },
    {
      id: 7,
      title: 'Docs',
      url: 'https://developer.mozilla.org/',
      active: false,
      windowId: 1,
    },
  ]
  return {
    tabsList: async () => tabs,
    tabsFocus: async (tabId) => {
      const t = tabs.find((x) => x.id === tabId)
      if (!t) throw new Error('missing')
      tabs.forEach((x) => (x.active = x.id === tabId))
      return t
    },
    tabsOpen: async (url) => {
      const t: TabInfo = { id: 99, title: url, url, active: true, windowId: 1 }
      tabs.push(t)
      return t
    },
    tabsClose: async () => ({ closed: true }),
    tabsGet: async (tabId) => tabs.find((t) => t.id === tabId) ?? null,
    navigate: async (tabId, url) => {
      const t = tabs.find((x) => x.id === tabId)!
      t.url = url
      return t
    },
    waitForLoad: async () => undefined,
    pageRead: async () => ({
      pageContent: FIXTURE_A11Y,
      viewport: { width: 1280, height: 720 },
    }),
    pageScreenshot: async () => ({
      mimeType: 'image/jpeg',
      dataBase64: Buffer.from('fake').toString('base64'),
      byteLength: 4,
    }),
    resolveRef: async () => ({ ok: true, x: 100, y: 200 }),
    click: async () => ({ x: 100, y: 200 }),
    type: async () => ({ typed: 'test' }),
    scroll: async () => ({ direction: 'down' as const }),
    hover: async () => ({ x: 50, y: 60 }),
    select: async () => ({ selected: 'opt', refId: 'ref_1' }),
  }
}

describe.runIf(Boolean(KEY))('live Sprint 3 browser tools', () => {
  it(
    'LLM uses tabs_list and page_read against fake bridge',
    async () => {
      const events: StreamEvent[] = []
      const model = await getModel('openai-compatible', MODEL, {
        apiKey: KEY,
        baseURL: BASE,
      })
      const ruleset = fromConfig(DEFAULT_CONFIG.agent.browse!.permission!)
      const browser = createLiveFakeBridge()
      const tools = toAiSdkTools(filterToolsByPermission(listTools(), ruleset), {
        sessionId: 'live-s3',
        tabId: 42,
        boundTabId: 42,
        browser,
        ask: async () => undefined,
      })

      const result = await runAgentLoop({
        model,
        messages: [
          {
            role: 'user',
            content:
              '1) Call tabs_list. 2) Call page_read on the active tab. 3) Briefly answer: what is the page heading? Use tools; do not invent.',
          },
        ],
        system:
          DEFAULT_CONFIG.agent.browse!.prompt +
          '\n\nActive tab: "Example Domain" — https://example.com/ (tabId 42)',
        tools,
        steps: 8,
        onEvent: (e) => events.push(e),
      })

      const toolCalls = events.filter((e) => e.kind === 'tool-call')
      const names = toolCalls.map((e) => (e.kind === 'tool-call' ? e.toolName : ''))
      console.log('tool calls:', names)
      console.log(
        'text:',
        events
          .filter((e) => e.kind === 'text-delta')
          .map((e) => (e.kind === 'text-delta' ? e.text : ''))
          .join('')
          .slice(0, 400),
      )
      console.log('finish:', result)

      expect(names).toContain('tabs_list')
      expect(names).toContain('page_read')
      const text = events
        .filter((e) => e.kind === 'text-delta')
        .map((e) => (e.kind === 'text-delta' ? e.text : ''))
        .join('')
        .toLowerCase()
      expect(text).toMatch(/example/)
    },
    120_000,
  )

  it(
    'LLM uses page_grep to find Learn more button',
    async () => {
      const events: StreamEvent[] = []
      const model = await getModel('openai-compatible', MODEL, {
        apiKey: KEY,
        baseURL: BASE,
      })
      const ruleset = fromConfig(DEFAULT_CONFIG.agent.browse!.permission!)
      const tools = toAiSdkTools(filterToolsByPermission(listTools(), ruleset), {
        sessionId: 'live-grep',
        tabId: 42,
        boundTabId: 42,
        browser: createLiveFakeBridge(),
        ask: async () => undefined,
      })

      await runAgentLoop({
        model,
        messages: [
          {
            role: 'user',
            content:
              'Use page_grep with pattern "Learn more" and report which ref_id matched. Call the tool.',
          },
        ],
        system: DEFAULT_CONFIG.agent.browse!.prompt,
        tools,
        steps: 6,
        onEvent: (e) => events.push(e),
      })

      const greps = events.filter((e) => e.kind === 'tool-call' && e.toolName === 'page_grep')
      console.log('grep calls:', greps)
      expect(greps.length).toBeGreaterThan(0)
      const results = events.filter((e) => e.kind === 'tool-result')
      expect(JSON.stringify(results)).toMatch(/ref_5/)
    },
    90_000,
  )
})
