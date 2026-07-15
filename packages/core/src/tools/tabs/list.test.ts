import { describe, expect, it } from 'vitest'
import type { TabInfo } from '../browser.js'
import { tabsListTool } from './list.js'
import { createFakeBrowserBridge, toolCtx } from './fake-bridge.js'
import { truncateTabsList } from './truncate.js'

describe('tabs_list', () => {
  it('returns open tabs from the browser bridge', async () => {
    const browser = createFakeBrowserBridge()
    const result = await tabsListTool.execute({}, toolCtx(browser))

    expect(result).toEqual({
      tabs: [
        { id: 1, title: 'Tab A', url: 'https://a.example', active: true, windowId: 1 },
        { id: 2, title: 'Tab B', url: 'https://b.example', active: false, windowId: 1 },
      ],
      total: 2,
    })
  })

  it('truncates when more than 50 tabs', async () => {
    const manyTabs: TabInfo[] = Array.from({ length: 60 }, (_, i) => ({
      id: i + 1,
      title: `Tab ${i + 1}`,
      url: `https://example/${i + 1}`,
      active: i === 0,
      windowId: 1,
    }))
    const browser = createFakeBrowserBridge({ tabsList: async () => manyTabs })
    const result = (await tabsListTool.execute({}, toolCtx(browser))) as { tabs: TabInfo[]; truncated?: boolean; total?: number }

    expect(result.tabs).toHaveLength(50)
    expect(result.truncated).toBe(true)
    expect(result.total).toBe(60)
  })

  it('requires browser bridge', async () => {
    await expect(
      tabsListTool.execute({}, { sessionId: 's1', ask: async () => undefined }),
    ).rejects.toThrow(/Browser bridge unavailable/)
  })
})

describe('truncateTabsList', () => {
  it('keeps output under 10 KB for large tab payloads', () => {
    const hugeTabs: TabInfo[] = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      title: 'x'.repeat(500),
      url: `https://example/${'y'.repeat(200)}/${i}`,
      active: false,
      windowId: 1,
    }))
    const result = truncateTabsList(hugeTabs)
    const bytes = new TextEncoder().encode(JSON.stringify(result)).length
    expect(bytes).toBeLessThanOrEqual(10 * 1024)
    expect(result.truncated).toBe(true)
  })
})
