import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'
import { pageUrlPermissionPatterns } from '../page-url-pattern.js'

export const typeTool = defineTool({
  id: 'type',
  description:
    'Type text into the focused field, or click ref_id first to focus an input/textarea. ' +
    'Set paste=true for rich-text editors (uses temporary clipboard snapshot/restore).',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    text: z.string().describe('Text to insert'),
    refId: z
      .string()
      .optional()
      .describe('Optional ref_id to focus before typing'),
    paste: z
      .boolean()
      .optional()
      .describe('Use clipboard paste path for contenteditable / rich-text editors'),
  }),
  permission: 'type',
  permissionPatterns: (args, ctx) =>
    pageUrlPermissionPatterns(ctx!, args.tabId),
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    return browser.type(tabId, {
      text: args.text,
      refId: args.refId,
      paste: args.paste,
    })
  },
})
