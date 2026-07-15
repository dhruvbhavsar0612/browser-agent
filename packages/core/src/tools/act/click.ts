import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'
import { pageUrlPermissionPatterns } from '../page-url-pattern.js'

export const clickTool = defineTool({
  id: 'click',
  description:
    'Click an element by ref_id from page_read, or at explicit viewport x/y coordinates.',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    refId: z.string().optional().describe('Element ref_id, e.g. ref_3'),
    x: z.number().optional().describe('Viewport x coordinate (use with y)'),
    y: z.number().optional().describe('Viewport y coordinate (use with x)'),
    button: z.enum(['left', 'right']).optional().describe('Mouse button (default left)'),
    clickCount: z.number().int().positive().optional().describe('Click count (default 1)'),
  }),
  permission: 'click',
  permissionPatterns: (args, ctx) =>
    pageUrlPermissionPatterns(ctx!, args.tabId),
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    if (!args.refId && (args.x == null || args.y == null)) {
      throw new Error('click: provide refId or both x and y')
    }
    return browser.click(tabId, args)
  },
})
