import type { ToolContext } from './index.js'
import { resolveTabId } from './browser.js'

/** Permission patterns for act tools — current tab URL when available. */
export async function pageUrlPermissionPatterns(
  ctx: ToolContext,
  tabId?: number,
): Promise<string[]> {
  const browser = ctx.browser
  if (!browser) return ['*']
  try {
    const id = tabId != null ? tabId : resolveTabId(ctx)
    const tab = await browser.tabsGet(id)
    if (tab?.url) return [tab.url]
  } catch {
    // fall through to wildcard
  }
  return ['*']
}
