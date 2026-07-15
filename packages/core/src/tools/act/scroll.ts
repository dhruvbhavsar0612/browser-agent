import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'
import { pageUrlPermissionPatterns } from '../page-url-pattern.js'

export const scrollTool = defineTool({
  id: 'scroll',
  description: 'Scroll the page up, down, to top, or to bottom.',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    direction: z
      .enum(['up', 'down', 'top', 'bottom'])
      .describe('Scroll direction'),
    amount: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Pixel amount for up/down (defaults to ~70% viewport height)'),
  }),
  permission: 'scroll',
  permissionPatterns: (args, ctx) =>
    pageUrlPermissionPatterns(ctx!, args.tabId),
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    return browser.scroll(tabId, {
      direction: args.direction,
      amount: args.amount,
    })
  },
})
