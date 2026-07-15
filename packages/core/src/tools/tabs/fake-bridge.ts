import type { BrowserBridge, BrowserToolContext, TabInfo } from '../browser.js'

export function createFakeBrowserBridge(overrides: Partial<BrowserBridge> = {}): BrowserBridge {
  const tabs: TabInfo[] = [
    { id: 1, title: 'Tab A', url: 'https://a.example', active: true, windowId: 1 },
    { id: 2, title: 'Tab B', url: 'https://b.example', active: false, windowId: 1 },
  ]

  return {
    tabsList: async () => [...tabs],
    tabsFocus: async (tabId) => {
      const tab = tabs.find((t) => t.id === tabId)
      if (!tab) throw new Error(`Tab ${tabId} not found`)
      for (const t of tabs) t.active = t.id === tabId
      return { ...tab, active: true }
    },
    tabsOpen: async (url, opts) => {
      const tab: TabInfo = {
        id: tabs.length + 1,
        title: url,
        url,
        active: !opts?.background,
        windowId: 1,
      }
      tabs.push(tab)
      return tab
    },
    tabsClose: async (tabId) => {
      const idx = tabs.findIndex((t) => t.id === tabId)
      if (idx === -1) throw new Error(`Tab ${tabId} not found`)
      tabs.splice(idx, 1)
      return { closed: true }
    },
    tabsGet: async (tabId) => tabs.find((t) => t.id === tabId) ?? null,
    navigate: async () => {
      throw new Error('not implemented')
    },
    waitForLoad: async () => undefined,
    pageRead: async () => {
      throw new Error('not implemented')
    },
    pageScreenshot: async () => {
      throw new Error('not implemented')
    },
    ...overrides,
  }
}

export function toolCtx(
  browser: BrowserBridge,
  overrides: Partial<BrowserToolContext> = {},
): BrowserToolContext {
  return {
    sessionId: 'test-session',
    ask: async () => undefined,
    browser,
    ...overrides,
  }
}
