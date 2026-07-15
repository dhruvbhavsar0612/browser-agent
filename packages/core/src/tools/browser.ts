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

export type ResolveRefResult =
  | { ok: true; x: number; y: number }
  | { ok: false; error: string }

export type ClickOptions = {
  refId?: string
  x?: number
  y?: number
  button?: 'left' | 'right'
  clickCount?: number
}

export type HoverOptions = {
  refId?: string
  x?: number
  y?: number
}

export type TypeOptions = {
  text: string
  refId?: string
  /** Use clipboard paste path for rich-text editors (ProseMirror, etc.). */
  paste?: boolean
}

export type TypeResult = {
  typed: string
  refId?: string
  strategy?: 'insert_text' | 'clipboard_paste'
  clipboard_restore_mode?: 'full' | 'text' | 'failed' | 'skipped'
  clipboard_restore_error?: string
}

export type ScrollOptions = {
  direction: 'up' | 'down' | 'top' | 'bottom'
  amount?: number
}

export type SelectOptions = {
  refId: string
  value?: string
  label?: string
}

export type BrowserBridge = {
  tabsList: () => Promise<TabInfo[]>
  tabsFocus: (tabId: number) => Promise<TabInfo>
  tabsOpen: (
    url: string,
    opts?: { background?: boolean; sessionId?: string; groupTitle?: string },
  ) => Promise<TabInfo>
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
  resolveRef: (tabId: number, refId: string) => Promise<ResolveRefResult>
  click: (tabId: number, opts: ClickOptions) => Promise<{ x: number; y: number; refId?: string }>
  type: (tabId: number, opts: TypeOptions) => Promise<TypeResult>
  scroll: (tabId: number, opts: ScrollOptions) => Promise<{ direction: ScrollOptions['direction'] }>
  hover: (tabId: number, opts: HoverOptions) => Promise<{ x: number; y: number; refId?: string }>
  select: (
    tabId: number,
    opts: SelectOptions,
  ) => Promise<{ selected: string; refId: string }>
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
