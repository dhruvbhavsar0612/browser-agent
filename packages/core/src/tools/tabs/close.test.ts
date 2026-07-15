import { describe, expect, it } from 'vitest'
import { tabsCloseTool } from './close.js'
import { createFakeBrowserBridge, toolCtx } from './fake-bridge.js'

describe('tabs_close', () => {
  it('closes a tab by id', async () => {
    const browser = createFakeBrowserBridge()
    const result = await tabsCloseTool.execute({ tabId: 1 }, toolCtx(browser))

    expect(result).toEqual({ closed: true })
    const list = await browser.tabsList()
    expect(list.map((t) => t.id)).toEqual([2])
  })
})
