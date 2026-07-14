import { z } from 'zod'
import { defineTool } from '../index.js'

export const getTimeTool = defineTool({
  id: 'get_time',
  description: 'Return the current time as an ISO-8601 timestamp.',
  parameters: z.object({}),
  permission: 'get_time',
  permissionPatterns: () => ['*'],
  execute: async () => ({ time: new Date().toISOString() }),
})
