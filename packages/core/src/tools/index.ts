import { z } from 'zod'
import { navigateTool } from './navigate.js'
import { clickTool } from './act/click.js'
import { hoverTool } from './act/hover.js'
import { scrollTool } from './act/scroll.js'
import { selectTool } from './act/select.js'
import { typeTool } from './act/type.js'
import { pageGrepTool } from './page/grep.js'
import { pageReadTool } from './page/read.js'
import { pageScreenshotTool } from './page/screenshot.js'
import { tabsCloseTool } from './tabs/close.js'
import { tabsFocusTool } from './tabs/focus.js'
import { tabsListTool } from './tabs/list.js'
import { tabsOpenTool } from './tabs/open.js'
import { echoTool } from './stubs/echo.js'
import { getTimeTool } from './stubs/get-time.js'

export interface ToolContext {
  sessionId: string
  tabId?: number
  boundTabId?: number
  browser?: import('./browser.js').BrowserBridge
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
  permissionPatterns: (args: unknown, ctx?: ToolContext) => string[] | Promise<string[]>
  execute: (args: unknown, ctx: ToolContext) => Promise<unknown>
}

export function defineTool<T extends z.ZodTypeAny>(tool: {
  id: string
  description: string
  parameters: T
  permission: string
  permissionPatterns: (args: z.infer<T>, ctx?: ToolContext) => string[] | Promise<string[]>
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown>
}): ToolDefinition {
  return {
    id: tool.id,
    description: tool.description,
    parameters: tool.parameters,
    permission: tool.permission,
    permissionPatterns: (args, ctx) => tool.permissionPatterns(args as z.infer<T>, ctx),
    execute: (args, ctx) => tool.execute(args as z.infer<T>, ctx),
  }
}

export function listTools(): ToolDefinition[] {
  return [
    echoTool,
    getTimeTool,
    tabsListTool,
    tabsFocusTool,
    tabsOpenTool,
    tabsCloseTool,
    navigateTool,
    pageReadTool,
    pageGrepTool,
    pageScreenshotTool,
    clickTool,
    typeTool,
    scrollTool,
    hoverTool,
    selectTool,
  ]
}

export { echoTool } from './stubs/echo.js'
export { getTimeTool } from './stubs/get-time.js'
export { navigateTool } from './navigate.js'
export { clickTool } from './act/click.js'
export { typeTool } from './act/type.js'
export { scrollTool } from './act/scroll.js'
export { hoverTool } from './act/hover.js'
export { selectTool } from './act/select.js'
export { pageGrepTool } from './page/grep.js'
export { pageReadTool } from './page/read.js'
export { pageScreenshotTool } from './page/screenshot.js'
export { tabsCloseTool } from './tabs/close.js'
export { tabsFocusTool } from './tabs/focus.js'
export { tabsListTool } from './tabs/list.js'
export { tabsOpenTool } from './tabs/open.js'
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
  type ClickOptions,
  type HoverOptions,
  type ResolveRefResult,
  type ScreenshotResult,
  type ScrollOptions,
  type SelectOptions,
  type TabInfo,
  type TypeOptions,
} from './browser.js'
export { pageUrlPermissionPatterns } from './page-url-pattern.js'
