import { z } from 'zod'

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

export interface ToolDefinition<T extends z.ZodType = z.ZodType> {
  id: string
  description: string
  parameters: T
  permission: string
  permissionPatterns: (args: z.infer<T>) => string[]
  execute: (args: z.infer<T>, ctx: ToolContext) => Promise<unknown>
}

export function defineTool<T extends z.ZodType>(tool: ToolDefinition<T>): ToolDefinition<T> {
  return tool
}

/** Placeholder registry — browser tools land in S3/S4 */
export function listTools(): ToolDefinition[] {
  return []
}
