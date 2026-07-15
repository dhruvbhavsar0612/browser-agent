import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'

const MAX_SCREENSHOT_BYTES = 1024 * 1024

export const pageScreenshotTool = defineTool({
  id: 'page_screenshot',
  description:
    'Capture a JPEG or PNG screenshot of the visible viewport. Requires a vision-capable model to interpret the image.',
  parameters: z.object({
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    format: z
      .enum(['jpeg', 'png'])
      .optional()
      .describe('Image format (default jpeg)'),
  }),
  permission: 'screenshot',
  permissionPatterns: () => ['*'],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)
    const result = await browser.pageScreenshot(tabId, { format: args.format ?? 'jpeg' })

    return {
      mimeType: result.mimeType,
      dataBase64: result.dataBase64,
      byteLength: result.byteLength,
      ...(result.byteLength > MAX_SCREENSHOT_BYTES
        ? {
            truncatedNote:
              'Screenshot exceeds ~1 MB cap after compression; image may be unsuitable for the model context',
          }
        : {}),
    }
  },
})
