import { describe, expect, it, vi } from 'vitest'
import type { BrowserBridge } from '../browser.js'
import { FIXTURE_A11Y_PAGE, FIXTURE_VIEWPORT } from './fixture.js'
import { extractRefIds, grepPageContent, pageGrepTool } from './grep.js'

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

describe('grepPageContent', () => {
  it('finds matches with context and ref_ids', () => {
    const result = grepPageContent(FIXTURE_A11Y_PAGE, 'Submit')

    expect(result).toEqual({
      pattern: 'Submit',
      matchCount: 1,
      matches: [
        {
          lineNumber: 2,
          line: 'button "Submit" [ref_2]',
          match: 'Submit',
          refIds: ['ref_2'],
          context: {
            before: ['heading "Welcome" [ref_1]'],
            after: ['link "Documentation" [ref_3]'],
          },
        },
      ],
    })
  })

  it('is case-insensitive by default', () => {
    const result = grepPageContent(FIXTURE_A11Y_PAGE, 'documentation')
    expect(result.matchCount).toBe(1)
    expect(result.matches[0]?.line).toContain('Documentation')
  })

  it('respects caseSensitive and maxMatches', () => {
    expect(grepPageContent(FIXTURE_A11Y_PAGE, 'documentation', { caseSensitive: true }).matchCount).toBe(
      0,
    )

    const manyLines = Array.from({ length: 10 }, (_, i) => `line match-${i}`).join('\n')
    const capped = grepPageContent(manyLines, 'match', { maxMatches: 3 })
    expect(capped.matchCount).toBe(3)
    expect(capped.truncated).toBe(true)
  })

  it('throws on invalid regex', () => {
    expect(() => grepPageContent('text', '(unclosed')).toThrow(/Invalid regex/)
  })
})

describe('extractRefIds', () => {
  it('pulls ref_ids from bracketed tokens', () => {
    expect(extractRefIds('button "Go" [ref_42]')).toEqual(['ref_42'])
    expect(extractRefIds('no refs here')).toEqual([])
  })
})

describe('page_grep tool', () => {
  it('searches page content via pageRead', async () => {
    const browser = fakeBrowser()
    const result = await pageGrepTool.execute({ pattern: 'Search' }, ctx(browser))

    expect(browser.pageRead).toHaveBeenCalledWith(7, { filter: 'all', maxChars: 50_000 })
    expect(result).toMatchObject({
      pattern: 'Search',
      matchCount: 1,
      matches: [
        expect.objectContaining({
          line: 'textbox "Search" [ref_4]',
          refIds: ['ref_4'],
        }),
      ],
    })
  })

  it('returns empty matches when pageRead reports an error', async () => {
    const browser = fakeBrowser({
      pageRead: vi.fn(async () => ({
        pageContent: '',
        viewport: FIXTURE_VIEWPORT,
        error: 'tab not ready',
      })),
    })

    const result = await pageGrepTool.execute({ pattern: 'foo' }, ctx(browser))

    expect(result).toEqual({
      pattern: 'foo',
      matchCount: 0,
      matches: [],
      error: 'tab not ready',
    })
  })

  it('throws when the browser bridge is unavailable', async () => {
    await expect(
      pageGrepTool.execute(
        { pattern: 'x' },
        { sessionId: 'sess-1', ask: vi.fn(async () => undefined) },
      ),
    ).rejects.toThrow(/bridge unavailable/)
  })
})
