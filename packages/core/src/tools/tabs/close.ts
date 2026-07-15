import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'

export const tabsCloseTool = defineTool({
  id: 'tabs_close',
  description: 'Close a browser tab by id.',
  parameters: z.object({
    tabId: z.number().int().describe('Chrome tab id to close'),
    force: z.boolean().optional().describe('Reserved for future forced-close behavior'),
  }),
  permission: 'tab_close',
  permissionPatterns: (args) => [String(args.tabId)],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    return browser.tabsClose(tabId)
  },
})
