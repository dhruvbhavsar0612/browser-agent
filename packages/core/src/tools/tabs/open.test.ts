import { describe, expect, it } from 'vitest'
import { tabsOpenTool } from './open.js'
import { createFakeBrowserBridge, toolCtx } from './fake-bridge.js'

describe('tabs_open', () => {
  it('opens a tab at the given url', async () => {
    const browser = createFakeBrowserBridge()
    const result = await tabsOpenTool.execute(
      { url: 'https://new.example/page' },
      toolCtx(browser),
    )

    expect(result).toEqual({
      tab: {
        id: 3,
        title: 'https://new.example/page',
        url: 'https://new.example/page',
        active: true,
        windowId: 1,
      },
    })
    const list = await browser.tabsList()
    expect(list).toHaveLength(3)
  })

  it('opens in background when requested', async () => {
    const browser = createFakeBrowserBridge()
    const result = await tabsOpenTool.execute(
      { url: 'https://bg.example', background: true },
      toolCtx(browser),
    )
    expect((result as { tab: { active: boolean } }).tab.active).toBe(false)
  })
})
