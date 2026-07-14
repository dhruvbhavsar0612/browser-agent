import type { PermissionAction } from '../config/schema.js'

export interface PermissionRuleEntry {
  permission: string
  pattern: string
  action: PermissionAction
}

export interface PermissionAskInput {
  id?: string
  sessionID: string
  permission: string
  patterns: string[]
  metadata?: unknown
  ruleset: PermissionRuleEntry[]
}

function matchWildcard(value: string, pattern: string): boolean {
  if (pattern === '*') return true
  // Escape regex special chars except * which becomes .*
  const escaped = pattern
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`).test(value)
}

export function evaluate(
  permission: string,
  pattern: string,
  ...rulesets: PermissionRuleEntry[][]
): PermissionRuleEntry {
  const flat = rulesets.flat()
  for (let i = flat.length - 1; i >= 0; i--) {
    const rule = flat[i]!
    if (matchWildcard(permission, rule.permission) && matchWildcard(pattern, rule.pattern)) {
      return rule
    }
  }
  return { action: 'ask', permission, pattern: '*' }
}

export function fromConfig(
  config: Record<string, PermissionAction | Record<string, PermissionAction>> | PermissionAction,
): PermissionRuleEntry[] {
  if (typeof config === 'string') {
    return [{ permission: '*', pattern: '*', action: config }]
  }
  const rules: PermissionRuleEntry[] = []
  for (const [permission, value] of Object.entries(config)) {
    if (typeof value === 'string') {
      rules.push({ permission, pattern: '*', action: value })
    } else {
      for (const [pattern, action] of Object.entries(value)) {
        rules.push({ permission, pattern, action })
      }
    }
  }
  return rules
}

export function mergeRules(...rulesets: PermissionRuleEntry[][]): PermissionRuleEntry[] {
  return rulesets.flat()
}
