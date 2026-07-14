import { z } from 'zod'
import { defineTool } from '../index.js'

export const echoTool = defineTool({
  id: 'echo',
  description: 'Echo back the provided text (demo stub tool).',
  parameters: z.object({
    text: z.string().describe('Text to echo back'),
  }),
  permission: 'echo',
  permissionPatterns: () => ['*'],
  execute: async (args) => ({ echoed: args.text }),
})
