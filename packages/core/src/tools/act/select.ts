import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'
import { pageUrlPermissionPatterns } from '../page-url-pattern.js'

export const selectTool = defineTool({
  id: 'select',
  description: 'Choose an option on a <select> element identified by ref_id.',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    refId: z.string().describe('ref_id of the <select> element'),
    value: z.string().optional().describe('Option value attribute'),
    label: z.string().optional().describe('Visible option label text'),
  }),
  permission: 'select',
  permissionPatterns: (args, ctx) =>
    pageUrlPermissionPatterns(ctx!, args.tabId),
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    if (!args.value && !args.label) {
      throw new Error('select: provide value or label')
    }
    return browser.select(tabId, {
      refId: args.refId,
      value: args.value,
      label: args.label,
    })
  },
})
