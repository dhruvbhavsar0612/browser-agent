import { describe, expect, it, vi } from 'vitest'
import type { BrowserBridge } from './browser.js'
import { navigateTool } from './navigate.js'

function fakeBrowser(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    tabsList: vi.fn(),
    tabsFocus: vi.fn(),
    tabsOpen: vi.fn(),
    tabsClose: vi.fn(),
    tabsGet: vi.fn(),
    navigate: vi.fn(async (tabId, url) => ({
      id: tabId,
      title: 'Example',
      url,
      active: true,
      windowId: 1,
    })),
    waitForLoad: vi.fn(),
    pageRead: vi.fn(),
    pageScreenshot: vi.fn(),
    resolveRef: vi.fn(async () => ({ ok: false as const, error: 'not implemented' })),
    click: vi.fn(),
    type: vi.fn(),
    scroll: vi.fn(),
    hover: vi.fn(),
    select: vi.fn(),
    ...overrides,
  }
}

function ctx(browser: BrowserBridge, tabId = 42) {
  return {
    sessionId: 'sess-1',
    tabId,
    boundTabId: tabId,
    browser,
    ask: vi.fn(async () => undefined),
  }
}

describe('navigate tool', () => {
  it('navigates the session tab and returns tab info', async () => {
    const browser = fakeBrowser()
    const result = await navigateTool.execute({ url: 'https://example.com' }, ctx(browser))

    expect(browser.navigate).toHaveBeenCalledWith(42, 'https://example.com')
    expect(result).toEqual({
      tab: expect.objectContaining({ id: 42, url: 'https://example.com' }),
    })
  })

  it('uses an explicit tabId when provided', async () => {
    const browser = fakeBrowser()
    await navigateTool.execute({ url: 'https://example.com/page', tabId: 99 }, ctx(browser))

    expect(browser.navigate).toHaveBeenCalledWith(99, 'https://example.com/page')
  })

  it('throws when the browser bridge is unavailable', async () => {
    await expect(
      navigateTool.execute(
        { url: 'https://example.com' },
        { sessionId: 'sess-1', ask: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/bridge unavailable/)
  })

  it('uses the navigated URL as the permission pattern', () => {
    expect(navigateTool.permissionPatterns({ url: 'https://example.com/path' })).toEqual([
      'https://example.com/path',
    ])
  })
})
