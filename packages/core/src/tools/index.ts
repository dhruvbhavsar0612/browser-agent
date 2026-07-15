import { z } from 'zod'
import { echoTool } from './stubs/echo.js'
import { getTimeTool } from './stubs/get-time.js'

export interface ToolContext {
  sessionId: string
  tabId?: number
  signal?: AbortSignal
  ask: (input: {
    permission: string
    patterns: string[]
    metadata?: unknown
  }) => Promise<void>
}

export interface ToolDefinition {
  id: string
  description: string
  parameters: z.ZodTypeAny
  permission: string
  permissionPatterns: (args: unknown) => string[]
  execute: (args: unknown, ctx: ToolContext) => Promise<unknown>
}

export function defineTool<T extends z.ZodTypeAny>(tool: {
  id: string
  description: string
  parameters: T
  permission: string
  permissionPatterns: (args: z.infer<T>) => string[]
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown>
}): ToolDefinition {
  return {
    id: tool.id,
    description: tool.description,
    parameters: tool.parameters,
    permission: tool.permission,
    permissionPatterns: (args) => tool.permissionPatterns(args as z.infer<T>),
    execute: (args, ctx) => tool.execute(args as z.infer<T>, ctx),
  }
}

export function listTools(): ToolDefinition[] {
  return [echoTool, getTimeTool]
}

export { echoTool } from './stubs/echo.js'
export { getTimeTool } from './stubs/get-time.js'
export {
  filterToolsByPermission,
  isToolAvailable,
  toAiSdkTools,
} from './ai-sdk.js'
export {
  requireBrowser,
  resolveTabId,
  type A11yFilter,
  type A11yTreeResult,
  type BrowserBridge,
  type BrowserToolContext,
  type ScreenshotResult,
  type TabInfo,
} from './browser.js'
