import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'

export const DEFAULT_PAGE_READ_MAX_CHARS = 50_000

export const pageReadTool = defineTool({
  id: 'page_read',
  description:
    'Return the accessibility tree of the page as structured text with ref_ids for interactive elements.',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    filter: z
      .enum(['interactive', 'all'])
      .optional()
      .describe('interactive = buttons/links/inputs only; all = full visible tree (default all)'),
    maxChars: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Max characters to return (default 50000, hard cap 50000)'),
  }),
  permission: 'page_read',
  permissionPatterns: () => ['*'],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    const maxChars = Math.min(args.maxChars ?? DEFAULT_PAGE_READ_MAX_CHARS, DEFAULT_PAGE_READ_MAX_CHARS)

    const result = await browser.pageRead(tabId, {
      filter: args.filter ?? 'all',
      maxChars,
    })

    let pageContent = result.pageContent
    let truncated = result.truncated ?? false
    if (pageContent.length > maxChars) {
      pageContent = pageContent.slice(0, maxChars)
      truncated = true
    }

    return {
      pageContent,
      viewport: result.viewport,
      ...(result.error ? { error: result.error } : {}),
      ...(truncated ? { truncated: true } : {}),
    }
  },
})
