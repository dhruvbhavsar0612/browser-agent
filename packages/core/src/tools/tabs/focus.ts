import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'

export const tabsFocusTool = defineTool({
  id: 'tabs_focus',
  description: 'Switch focus to a browser tab by id.',
  parameters: z.object({
    tabId: z.number().int().describe('Chrome tab id to focus'),
  }),
  permission: 'tab_focus',
  permissionPatterns: (args) => [String(args.tabId)],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    const tab = await browser.tabsFocus(tabId)
    return { tab }
  },
})
