import { tool, type ToolSet } from 'ai'
import { evaluate, type PermissionRuleEntry } from '../permission/index.js'
import type { ToolContext, ToolDefinition } from './index.js'

/** True when the tool is not denied by permission rules (ask/allow both pass). */
export function isToolAvailable(
  def: ToolDefinition,
  ruleset: PermissionRuleEntry[],
  sessionApproved: PermissionRuleEntry[] = [],
): boolean {
  const rule = evaluate(def.permission, '*', ruleset, sessionApproved)
  return rule.action !== 'deny'
}

export function filterToolsByPermission(
  tools: ToolDefinition[],
  ruleset: PermissionRuleEntry[],
  sessionApproved: PermissionRuleEntry[] = [],
): ToolDefinition[] {
  return tools.filter((def) => isToolAvailable(def, ruleset, sessionApproved))
}

export function toAiSdkTools(tools: ToolDefinition[], ctx: ToolContext): ToolSet {
  const record: ToolSet = {}

  for (const def of tools) {
    record[def.id] = tool({
      description: def.description,
      inputSchema: def.parameters,
      execute: async (args) => {
        await ctx.ask({
          permission: def.permission,
          patterns: def.permissionPatterns(args),
          metadata: { tool: def.id, args },
        })
        return def.execute(args, ctx)
      },
    })
  }

  return record
}
