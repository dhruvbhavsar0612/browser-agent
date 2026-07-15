import type { ExecutionMode, PermissionConfig } from '../config/schema.js'
import { fromConfig, type PermissionRuleEntry } from './evaluate.js'

/** Hard denials for high-risk page paths — always applied last so they win. */
export const SENSITIVE_DEFAULT_RULES: PermissionRuleEntry[] = fromConfig({
  click: {
    '*://*/checkout*': 'deny',
    '*://*/payment*': 'deny',
    '*://*/pay*': 'deny',
    '*://*/login*': 'deny',
    '*://*/signin*': 'deny',
    '*://*/sign-in*': 'deny',
  },
  type: {
    '*://*/checkout*': 'deny',
    '*://*/payment*': 'deny',
    '*://*/pay*': 'deny',
    '*://*/login*': 'deny',
    '*://*/signin*': 'deny',
    '*://*/sign-in*': 'deny',
  },
  navigate: {
    '*://*/checkout*': 'deny',
    '*://*/payment*': 'deny',
    '*://*/login*': 'deny',
    '*://*/signin*': 'deny',
  },
  select: {
    '*://*/checkout*': 'deny',
    '*://*/payment*': 'deny',
  },
})

/**
 * Overlay rules for Plan / Approval / Auto.
 * Merged before agent + user config; sensitive defaults should still be last.
 */
export function rulesForExecutionMode(mode: ExecutionMode): PermissionRuleEntry[] {
  switch (mode) {
    case 'plan':
      return fromConfig({
        click: 'deny',
        type: 'deny',
        scroll: 'deny',
        hover: 'deny',
        select: 'deny',
        navigate: 'deny',
        tab_open: 'deny',
        tab_close: 'deny',
        screenshot: 'ask',
        page_read: 'allow',
        grep_page: 'allow',
        tabs: 'allow',
        tab_focus: 'allow',
        echo: 'allow',
        get_time: 'allow',
        doom_loop: 'ask',
      })
    case 'auto':
      return fromConfig({
        '*': 'allow',
        doom_loop: 'ask',
      })
    case 'approval':
    default:
      return []
  }
}

/**
 * Full ruleset for an agent run.
 * - Plan: mode denials apply after user/agent (cannot re-enable writes)
 * - Approval/Auto: user site rules apply after mode (custom denials beat auto-allow)
 * - Sensitive defaults always last
 */
export function buildRunRuleset(input: {
  executionMode: ExecutionMode
  agentRules?: PermissionRuleEntry[]
  userPermission?: PermissionConfig
}): PermissionRuleEntry[] {
  const agentRules = input.agentRules ?? []
  const modeRules = rulesForExecutionMode(input.executionMode)
  const userRules = normalizeUserRules(input.executionMode, input.userPermission)

  if (input.executionMode === 'plan') {
    return [...userRules, ...agentRules, ...modeRules, ...SENSITIVE_DEFAULT_RULES]
  }

  return [...agentRules, ...modeRules, ...userRules, ...SENSITIVE_DEFAULT_RULES]
}

/**
 * In auto mode, drop the default catch-all `*:ask` so mode allow can apply.
 * Explicit site rules (and any non-default catch-alls) are kept.
 */
function normalizeUserRules(
  mode: ExecutionMode,
  userPermission?: PermissionConfig,
): PermissionRuleEntry[] {
  const rules = fromConfig(userPermission ?? { '*': 'ask' })
  if (mode !== 'auto') return rules
  return rules.filter(
    (rule) => !(rule.permission === '*' && rule.pattern === '*' && rule.action === 'ask'),
  )
}
