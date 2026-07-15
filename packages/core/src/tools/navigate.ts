import { z } from 'zod'
import { defineTool } from './index.js'
import { requireBrowser, resolveTabId } from './browser.js'

export const navigateTool = defineTool({
  id: 'navigate',
  description: 'Navigate the session tab to a URL and wait for the page to finish loading.',
  parameters: z.object({
    url: z.string().url().describe('Absolute URL to navigate to'),
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
  }),
  permission: 'navigate',
  permissionPatterns: (args) => [args.url],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    const tab = await browser.navigate(tabId, args.url)
    return { tab }
  },
})
