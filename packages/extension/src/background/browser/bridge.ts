import type { BrowserBridge } from '@browser-agent/core'
import { generateA11yTree } from './a11y.js'
import {
  captureTabScreenshot,
  navigateTab,
  toTabInfo,
  waitForTabLoad,
} from './navigate-screenshot.js'

export type ChromeBridgeOverrides = Partial<BrowserBridge>

/**
 * Chrome extension implementation of BrowserBridge.
 * Tab tools (DHR-57); navigate/screenshot (DHR-59); pageRead via a11y (DHR-56).
 */
export function createBrowserBridge(overrides: ChromeBridgeOverrides = {}): BrowserBridge {
  const bridge: BrowserBridge = {
    tabsList: async () => {
      const tabs = await chrome.tabs.query({})
      return tabs.filter((tab) => tab.id != null).map(toTabInfo)
    },
    tabsFocus: async (tabId) => {
      const tab = await chrome.tabs.update(tabId, { active: true })
      if (!tab) {
        throw new Error(`Tab ${tabId} not found`)
      }
      return toTabInfo(tab)
    },
    tabsOpen: async (url, opts) => {
      const tab = await chrome.tabs.create({ url, active: !opts?.background })
      return toTabInfo(tab)
    },
    tabsClose: async (tabId) => {
      await chrome.tabs.remove(tabId)
      return { closed: true }
    },
    tabsGet: async (tabId) => {
      try {
        const tab = await chrome.tabs.get(tabId)
        return toTabInfo(tab)
      } catch {
        return null
      }
    },
    navigate: navigateTab,
    waitForLoad: waitForTabLoad,
    pageRead: generateA11yTree,
    pageScreenshot: captureTabScreenshot,
    ...overrides,
  }
  return bridge
}

export const createChromeBridge = createBrowserBridge
