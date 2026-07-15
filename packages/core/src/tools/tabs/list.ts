import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser } from '../browser.js'
import { truncateTabsList } from './truncate.js'

export const tabsListTool = defineTool({
  id: 'tabs_list',
  description: 'List all open browser tabs with id, title, url, and active state.',
  parameters: z.object({}),
  permission: 'tabs',
  permissionPatterns: () => ['*'],
  execute: async (_args, ctx) => {
    const browser = requireBrowser(ctx)
    const allTabs = await browser.tabsList()
    return truncateTabsList(allTabs)
  },
})
