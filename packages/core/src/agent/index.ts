import type { AgentConfig, AppConfig } from '../config/schema.js'
import { DEFAULT_CONFIG } from '../config/schema.js'
import type { PermissionRuleEntry } from '../permission/index.js'
import { fromConfig } from '../permission/index.js'

export interface AgentInfo {
  name: string
  description?: string
  mode: 'primary' | 'subagent' | 'all'
  permission: PermissionRuleEntry[]
  prompt?: string
  steps?: number
  hidden?: boolean
  disable?: boolean
}

function mergeAgentConfig(base: AgentConfig | undefined, override: AgentConfig): AgentConfig {
  if (!base) return override
  return {
    ...base,
    ...override,
    model: override.model ?? base.model,
    permission: override.permission ?? base.permission,
  }
}

function resolveAgentMap(config: AppConfig): Record<string, AgentConfig> {
  const merged: Record<string, AgentConfig> = { ...DEFAULT_CONFIG.agent }
  for (const [name, override] of Object.entries(config.agent ?? {})) {
    merged[name] = mergeAgentConfig(merged[name], override)
  }
  return merged
}

function toAgentInfo(name: string, cfg: AgentConfig): AgentInfo {
  return {
    name,
    description: cfg.description,
    mode: cfg.mode ?? 'primary',
    permission: fromConfig(cfg.permission ?? { '*': 'ask' }),
    prompt: cfg.prompt,
    steps: cfg.steps,
    hidden: cfg.hidden,
    disable: cfg.disable,
  }
}

export function listAgents(config?: AppConfig): AgentInfo[] {
  const cfg = config ?? DEFAULT_CONFIG
  const agents = resolveAgentMap(cfg)
  return Object.entries(agents).map(([name, agentCfg]) => toAgentInfo(name, agentCfg))
}

export function listVisibleAgents(config?: AppConfig): AgentInfo[] {
  return listAgents(config).filter(
    (agent) =>
      !agent.hidden &&
      !agent.disable &&
      (agent.mode === 'primary' || agent.mode === 'all'),
  )
}

export function getAgent(name: string, config?: AppConfig): AgentInfo | undefined {
  return listAgents(config).find((agent) => agent.name === name)
}

export {
  parseModelRef,
  resolveModelRef,
  streamChatText,
  toModelMessages,
} from './chat.js'
export type { ChatMessage, ChatRole, ModelRef, StreamChatOptions } from './chat.js'
export {
  processFullStream,
  truncateToolResultDefault,
  DEFAULT_TOOL_RESULT_MAX_CHARS,
} from './processor.js'
export type {
  DurablePart,
  DoomLoopOptions,
  ProcessFullStreamOptions,
  ProcessFullStreamResult,
} from './processor.js'
