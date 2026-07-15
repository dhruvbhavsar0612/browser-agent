import { describe, expect, it } from 'vitest'
import { tabsFocusTool } from './focus.js'
import { createFakeBrowserBridge, toolCtx } from './fake-bridge.js'

describe('tabs_focus', () => {
  it('focuses a tab by id', async () => {
    const browser = createFakeBrowserBridge()
    const result = await tabsFocusTool.execute({ tabId: 2 }, toolCtx(browser))

    expect(result).toEqual({
      tab: { id: 2, title: 'Tab B', url: 'https://b.example', active: true, windowId: 1 },
    })
    const list = await browser.tabsList()
    expect(list.find((t) => t.id === 2)?.active).toBe(true)
  })

  it('uses boundTabId when tabId omitted in resolve path', async () => {
    const browser = createFakeBrowserBridge()
    const result = await tabsFocusTool.execute(
      { tabId: 1 },
      toolCtx(browser, { boundTabId: 1 }),
    )
    expect((result as { tab: { id: number } }).tab.id).toBe(1)
  })
})
