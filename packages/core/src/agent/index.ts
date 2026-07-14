import type { PermissionRuleEntry } from '../permission/index.js'
import { fromConfig } from '../permission/index.js'
import { DEFAULT_CONFIG } from '../config/schema.js'

export interface AgentInfo {
  name: string
  description?: string
  mode: 'primary' | 'subagent' | 'all'
  permission: PermissionRuleEntry[]
  prompt?: string
  steps?: number
  hidden?: boolean
}

export function listAgents(): AgentInfo[] {
  return Object.entries(DEFAULT_CONFIG.agent).map(([name, cfg]) => ({
    name,
    description: cfg.description,
    mode: cfg.mode ?? 'primary',
    permission: fromConfig(cfg.permission ?? { '*': 'ask' }),
    prompt: cfg.prompt,
    steps: cfg.steps,
    hidden: cfg.hidden,
  }))
}

export function getAgent(name: string): AgentInfo | undefined {
  return listAgents().find((a) => a.name === name)
}
