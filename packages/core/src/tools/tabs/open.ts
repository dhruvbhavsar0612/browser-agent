import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser } from '../browser.js'

export const tabsOpenTool = defineTool({
  id: 'tabs_open',
  description: 'Open a new browser tab at the given URL.',
  parameters: z.object({
    url: z.string().url().describe('URL to open'),
    background: z
      .boolean()
      .optional()
      .describe('When true, open in background without focusing'),
  }),
  permission: 'tab_open',
  permissionPatterns: (args) => [args.url],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tab = await browser.tabsOpen(args.url, { background: args.background })
    return { tab }
  },
})
