import { describe, expect, it, vi } from 'vitest'
import type { BrowserBridge } from '../browser.js'
import { pageScreenshotTool } from './screenshot.js'

function fakeBrowser(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    tabsList: vi.fn(),
    tabsFocus: vi.fn(),
    tabsOpen: vi.fn(),
    tabsClose: vi.fn(),
    tabsGet: vi.fn(),
    navigate: vi.fn(),
    waitForLoad: vi.fn(),
    pageRead: vi.fn(),
    pageScreenshot: vi.fn(async () => ({
      mimeType: 'image/jpeg' as const,
      dataBase64: 'abc123',
      byteLength: 3,
    })),
    resolveRef: vi.fn(async () => ({ ok: false as const, error: 'not implemented' })),
    click: vi.fn(),
    type: vi.fn(),
    scroll: vi.fn(),
    hover: vi.fn(),
    select: vi.fn(),
    ...overrides,
  }
}

function ctx(browser: BrowserBridge, tabId = 7) {
  return {
    sessionId: 'sess-1',
    tabId,
    boundTabId: tabId,
    browser,
    ask: vi.fn(async () => undefined),
  }
}

describe('page_screenshot tool', () => {
  it('captures the session tab viewport', async () => {
    const browser = fakeBrowser()
    const result = await pageScreenshotTool.execute({}, ctx(browser))

    expect(browser.pageScreenshot).toHaveBeenCalledWith(7, { format: 'jpeg' })
    expect(result).toEqual({
      mimeType: 'image/jpeg',
      dataBase64: 'abc123',
      byteLength: 3,
    })
  })

  it('honors format and tabId parameters', async () => {
    const browser = fakeBrowser()
    await pageScreenshotTool.execute({ tabId: 12, format: 'png' }, ctx(browser))

    expect(browser.pageScreenshot).toHaveBeenCalledWith(12, { format: 'png' })
  })

  it('adds a truncated note when the image exceeds the size cap', async () => {
    const browser = fakeBrowser({
      pageScreenshot: vi.fn(async () => ({
        mimeType: 'image/jpeg' as const,
        dataBase64: 'x'.repeat(100),
        byteLength: 1_500_000,
      })),
    })

    const result = await pageScreenshotTool.execute({}, ctx(browser))

    expect(result).toMatchObject({
      byteLength: 1_500_000,
      truncatedNote: expect.stringContaining('1 MB'),
    })
  })

  it('throws when the browser bridge is unavailable', async () => {
    await expect(
      pageScreenshotTool.execute(
        {},
        { sessionId: 'sess-1', ask: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/bridge unavailable/)
  })
})
