import { describe, expect, it, vi } from 'vitest'
import type { BrowserBridge } from '../browser.js'
import { clickTool } from './click.js'
import { hoverTool } from './hover.js'
import { scrollTool } from './scroll.js'
import { selectTool } from './select.js'
import { typeTool } from './type.js'
import { toolCtx } from '../tabs/fake-bridge.js'

function actBridge(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    tabsList: async () => [],
    tabsFocus: async () => {
      throw new Error('not implemented')
    },
    tabsOpen: async () => {
      throw new Error('not implemented')
    },
    tabsClose: async () => ({ closed: true }),
    tabsGet: async () => ({
      id: 5,
      title: 'Form',
      url: 'https://example.com/form',
      active: true,
      windowId: 1,
    }),
    navigate: async () => {
      throw new Error('not implemented')
    },
    waitForLoad: async () => undefined,
    pageRead: async () => ({
      pageContent: '',
      viewport: { width: 800, height: 600 },
    }),
    pageScreenshot: async () => ({
      mimeType: 'image/jpeg',
      dataBase64: 'QQ==',
      byteLength: 1,
    }),
    resolveRef: async () => ({ ok: true, x: 10, y: 20 }),
    click: vi.fn(async () => ({ x: 10, y: 20, refId: 'ref_1' })),
    type: vi.fn(async () => ({ typed: 'hello', refId: 'ref_2' })),
    scroll: vi.fn(async () => ({ direction: 'down' as const })),
    hover: vi.fn(async () => ({ x: 30, y: 40, refId: 'ref_3' })),
    select: vi.fn(async () => ({ selected: 'Option A', refId: 'ref_4' })),
    ...overrides,
  }
}

describe('act tools', () => {
  it('click resolves ref and uses page URL permission pattern', async () => {
    const browser = actBridge()
    const ask = vi.fn(async () => undefined)
    const ctx = toolCtx(browser, { tabId: 5, ask })

    const patterns = await clickTool.permissionPatterns({ refId: 'ref_1' }, ctx)
    expect(patterns).toEqual(['https://example.com/form'])

    const result = await clickTool.execute({ refId: 'ref_1' }, ctx)
    expect(browser.click).toHaveBeenCalledWith(5, { refId: 'ref_1' })
    expect(result).toEqual({ x: 10, y: 20, refId: 'ref_1' })
  })

  it('type inserts text after optional focus ref', async () => {
    const browser = actBridge()
    const ctx = toolCtx(browser, { tabId: 5 })

    const result = await typeTool.execute({ text: 'hello', refId: 'ref_2' }, ctx)
    expect(browser.type).toHaveBeenCalledWith(5, {
      text: 'hello',
      refId: 'ref_2',
      paste: undefined,
    })
    expect(result).toEqual({ typed: 'hello', refId: 'ref_2' })
  })

  it('type forwards paste=true for rich-text path', async () => {
    const browser = actBridge({
      type: vi.fn(async () => ({
        typed: 'rich',
        strategy: 'clipboard_paste' as const,
        clipboard_restore_mode: 'text' as const,
      })),
    })
    const ctx = toolCtx(browser, { tabId: 5 })
    const result = await typeTool.execute({ text: 'rich', paste: true }, ctx)
    expect(browser.type).toHaveBeenCalledWith(5, {
      text: 'rich',
      refId: undefined,
      paste: true,
    })
    expect(result).toMatchObject({
      typed: 'rich',
      strategy: 'clipboard_paste',
      clipboard_restore_mode: 'text',
    })
  })

  it('scroll delegates direction to bridge', async () => {
    const browser = actBridge()
    const ctx = toolCtx(browser, { tabId: 5 })

    const result = await scrollTool.execute({ direction: 'down' }, ctx)
    expect(browser.scroll).toHaveBeenCalledWith(5, { direction: 'down', amount: undefined })
    expect(result).toEqual({ direction: 'down' })
  })

  it('hover moves to coordinates', async () => {
    const browser = actBridge()
    const ctx = toolCtx(browser, { tabId: 5 })

    const result = await hoverTool.execute({ x: 100, y: 200 }, ctx)
    expect(browser.hover).toHaveBeenCalledWith(5, { x: 100, y: 200 })
    expect(result).toEqual({ x: 30, y: 40, refId: 'ref_3' })
  })

  it('select chooses option by label', async () => {
    const browser = actBridge()
    const ctx = toolCtx(browser, { tabId: 5 })

    const result = await selectTool.execute(
      { refId: 'ref_4', label: 'Option A' },
      ctx,
    )
    expect(browser.select).toHaveBeenCalledWith(5, {
      refId: 'ref_4',
      value: undefined,
      label: 'Option A',
    })
    expect(result).toEqual({ selected: 'Option A', refId: 'ref_4' })
  })

  it('requires refId or coordinates for click', async () => {
    const browser = actBridge()
    const ctx = toolCtx(browser, { tabId: 5 })
    await expect(clickTool.execute({}, ctx)).rejects.toThrow('provide refId or both x and y')
  })
})
