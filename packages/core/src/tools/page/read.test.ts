import { describe, expect, it, vi } from 'vitest'
import type { BrowserBridge } from '../browser.js'
import { FIXTURE_A11Y_PAGE, FIXTURE_VIEWPORT } from './fixture.js'
import { pageReadTool } from './read.js'

function fakeBrowser(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  return {
    tabsList: vi.fn(),
    tabsFocus: vi.fn(),
    tabsOpen: vi.fn(),
    tabsClose: vi.fn(),
    tabsGet: vi.fn(),
    navigate: vi.fn(),
    waitForLoad: vi.fn(),
    pageRead: vi.fn(async () => ({
      pageContent: FIXTURE_A11Y_PAGE,
      viewport: FIXTURE_VIEWPORT,
    })),
    pageScreenshot: vi.fn(),
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

describe('page_read tool', () => {
  it('returns a11y tree and viewport for the session tab', async () => {
    const browser = fakeBrowser()
    const result = await pageReadTool.execute({}, ctx(browser))

    expect(browser.pageRead).toHaveBeenCalledWith(7, { filter: 'all', maxChars: 50_000 })
    expect(result).toEqual({
      pageContent: FIXTURE_A11Y_PAGE,
      viewport: FIXTURE_VIEWPORT,
    })
  })

  it('honors filter, tabId, and maxChars parameters', async () => {
    const browser = fakeBrowser()
    await pageReadTool.execute({ tabId: 12, filter: 'interactive', maxChars: 10_000 }, ctx(browser))

    expect(browser.pageRead).toHaveBeenCalledWith(12, { filter: 'interactive', maxChars: 10_000 })
  })

  it('enforces the 50KB cap even when args request more', async () => {
    const browser = fakeBrowser()
    await pageReadTool.execute({ maxChars: 100_000 }, ctx(browser))

    expect(browser.pageRead).toHaveBeenCalledWith(7, { filter: 'all', maxChars: 50_000 })
  })

  it('truncates pageContent returned over the cap', async () => {
    const longContent = 'x'.repeat(60_000)
    const browser = fakeBrowser({
      pageRead: vi.fn(async () => ({
        pageContent: longContent,
        viewport: FIXTURE_VIEWPORT,
      })),
    })

    const result = await pageReadTool.execute({}, ctx(browser))

    expect(result).toMatchObject({
      pageContent: 'x'.repeat(50_000),
      truncated: true,
      viewport: FIXTURE_VIEWPORT,
    })
  })

  it('passes through bridge errors and truncated flag', async () => {
    const browser = fakeBrowser({
      pageRead: vi.fn(async () => ({
        pageContent: 'partial',
        viewport: FIXTURE_VIEWPORT,
        error: 'frame unreachable',
        truncated: true,
      })),
    })

    const result = await pageReadTool.execute({}, ctx(browser))

    expect(result).toEqual({
      pageContent: 'partial',
      viewport: FIXTURE_VIEWPORT,
      error: 'frame unreachable',
      truncated: true,
    })
  })

  it('throws when the browser bridge is unavailable', async () => {
    await expect(
      pageReadTool.execute({}, { sessionId: 'sess-1', ask: vi.fn(async () => undefined) }),
    ).rejects.toThrow(/bridge unavailable/)
  })
})
