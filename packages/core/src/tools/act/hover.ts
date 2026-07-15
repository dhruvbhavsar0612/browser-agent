import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'
import { pageUrlPermissionPatterns } from '../page-url-pattern.js'

export const hoverTool = defineTool({
  id: 'hover',
  description: 'Move the mouse over an element by ref_id or viewport coordinates.',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    refId: z.string().optional().describe('Element ref_id'),
    x: z.number().optional().describe('Viewport x coordinate (use with y)'),
    y: z.number().optional().describe('Viewport y coordinate (use with x)'),
  }),
  permission: 'hover',
  permissionPatterns: (args, ctx) =>
    pageUrlPermissionPatterns(ctx!, args.tabId),
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    if (!args.refId && (args.x == null || args.y == null)) {
      throw new Error('hover: provide refId or both x and y')
    }
    return browser.hover(tabId, args)
  },
})
