import type { TabInfo } from '../browser.js'

const MAX_TABS = 50
const MAX_JSON_BYTES = 10 * 1024

export type TabsListResult = {
  tabs: TabInfo[]
  truncated?: boolean
  total?: number
}

/** Cap tab list at 50 entries and ~10 KB JSON per TOOLS.md. */
export function truncateTabsList(allTabs: TabInfo[]): TabsListResult {
  const total = allTabs.length
  let tabs = allTabs.slice(0, MAX_TABS)
  let truncated = total > MAX_TABS

  while (tabs.length > 0 && jsonByteLength({ tabs, truncated, total }) > MAX_JSON_BYTES) {
    tabs = tabs.slice(0, tabs.length - 1)
    truncated = true
  }

  return truncated ? { tabs, truncated: true, total } : { tabs, total }
}

function jsonByteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}
