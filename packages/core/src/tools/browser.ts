/**
 * Injectable Chrome/browser capabilities for tools.
 * Core tools call this interface; the extension SW provides the real impl.
 * Tests inject fakes — no chrome.* in unit tests.
 */
export type A11yFilter = 'interactive' | 'all'

export type A11yTreeResult = {
  pageContent: string
  viewport: { width: number; height: number }
  error?: string
  truncated?: boolean
}

export type TabInfo = {
  id: number
  title: string
  url: string
  active: boolean
  windowId: number
  pinned?: boolean
}

export type ScreenshotResult = {
  mimeType: 'image/jpeg' | 'image/png'
  /** base64 without data: URL prefix */
  dataBase64: string
  byteLength: number
}

export type BrowserBridge = {
  tabsList: () => Promise<TabInfo[]>
  tabsFocus: (tabId: number) => Promise<TabInfo>
  tabsOpen: (url: string, opts?: { background?: boolean }) => Promise<TabInfo>
  tabsClose: (tabId: number) => Promise<{ closed: boolean }>
  tabsGet: (tabId: number) => Promise<TabInfo | null>
  navigate: (tabId: number, url: string) => Promise<TabInfo>
  /** Wait until tab status is complete (best-effort timeout). */
  waitForLoad: (tabId: number, timeoutMs?: number) => Promise<void>
  /** Inject/ensure a11y content script and return tree. */
  pageRead: (
    tabId: number,
    opts?: { filter?: A11yFilter; maxChars?: number },
  ) => Promise<A11yTreeResult>
  pageScreenshot: (
    tabId: number,
    opts?: { format?: 'jpeg' | 'png'; quality?: number },
  ) => Promise<ScreenshotResult>
}

import type { ToolContext } from './index.js'

export type BrowserToolContext = ToolContext & {
  browser: BrowserBridge
  /** Bound session tab when set; tools fall back to this if args.tabId omitted */
  boundTabId?: number
}

export function requireBrowser(ctx: ToolContext): BrowserBridge {
  const browser = (ctx as BrowserToolContext).browser
  if (!browser) {
    throw new Error('Browser bridge unavailable — tool must run in the extension service worker')
  }
  return browser
}

export function resolveTabId(ctx: ToolContext, tabId?: number): number {
  const extended = ctx as BrowserToolContext
  const id = tabId ?? extended.boundTabId ?? ctx.tabId
  if (id == null || !Number.isFinite(id)) {
    throw new Error('No tabId provided and no session tab is bound')
  }
  return id
}
