import { z } from 'zod'

export const PermissionAction = z.enum(['allow', 'ask', 'deny'])
export type PermissionAction = z.infer<typeof PermissionAction>

export const PermissionRule = z.union([
  PermissionAction,
  z.record(z.string(), PermissionAction),
])
export type PermissionRule = z.infer<typeof PermissionRule>

export const PermissionConfig = z.union([
  PermissionAction,
  z
    .object({
      page_read: PermissionRule.optional(),
      click: PermissionRule.optional(),
      type: PermissionRule.optional(),
      navigate: PermissionRule.optional(),
      tabs: PermissionRule.optional(),
      tab_focus: PermissionRule.optional(),
      tab_open: PermissionRule.optional(),
      tab_close: PermissionRule.optional(),
      screenshot: PermissionRule.optional(),
      evaluate: PermissionRule.optional(),
      webfetch: PermissionRule.optional(),
      doom_loop: PermissionAction.optional(),
      task: PermissionRule.optional(),
      '*': PermissionAction.optional(),
    })
    .catchall(PermissionRule),
])
export type PermissionConfig = z.infer<typeof PermissionConfig>

export const ProviderModelConfig = z.object({
  name: z.string().optional(),
  tool_call: z.boolean().optional(),
})

export const ProviderConfig = z.object({
  npm: z.string().optional(),
  name: z.string().optional(),
  api: z.string().url().optional(),
  options: z
    .object({
      apiKey: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    })
    .passthrough()
    .optional(),
  models: z.record(z.string(), ProviderModelConfig).optional(),
})
export type ProviderConfig = z.infer<typeof ProviderConfig>

export const AgentConfig = z.object({
  description: z.string().optional(),
  mode: z.enum(['primary', 'subagent', 'all']).optional(),
  model: z
    .object({
      providerID: z.string(),
      modelID: z.string(),
    })
    .optional(),
  prompt: z.string().optional(),
  steps: z.number().positive().optional(),
  disable: z.boolean().optional(),
  permission: PermissionConfig.optional(),
  hidden: z.boolean().optional(),
})
export type AgentConfig = z.infer<typeof AgentConfig>

export const McpServerConfig = z.object({
  type: z.enum(['remote']).default('remote'),
  url: z.string().url(),
  headers: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
})
export type McpServerConfig = z.infer<typeof McpServerConfig>

export const AppConfig = z.object({
  model: z.string().optional(),
  small_model: z.string().optional(),
  provider: z.record(z.string(), ProviderConfig).default({}),
  agent: z.record(z.string(), AgentConfig).default({}),
  permission: PermissionConfig.default({ '*': 'ask' }),
  mcp: z.record(z.string(), McpServerConfig).default({}),
  executionMode: z.enum(['plan', 'approval', 'auto']).default('approval'),
})
export type AppConfig = z.infer<typeof AppConfig>

export const DEFAULT_CONFIG: AppConfig = {
  provider: {},
  agent: {
    browse: {
      description: 'Read-only research and extraction',
      mode: 'primary',
      permission: {
        page_read: 'allow',
        tabs: 'allow',
        click: 'deny',
        type: 'deny',
        navigate: 'deny',
      },
    },
    act: {
      description: 'Full browser automation',
      mode: 'primary',
      permission: { '*': 'ask' },
    },
    explore: {
      description: 'Fast multi-tab reconnaissance',
      mode: 'subagent',
      permission: {
        page_read: 'allow',
        tabs: 'allow',
        click: 'deny',
        type: 'deny',
        navigate: 'deny',
      },
    },
  },
  permission: { '*': 'ask' },
  mcp: {},
  executionMode: 'approval',
}

export function parseConfig(input: unknown): AppConfig {
  return AppConfig.parse(input)
}

export function mergeConfig(base: AppConfig, override: Partial<AppConfig>): AppConfig {
  return parseConfig({
    ...base,
    ...override,
    provider: { ...base.provider, ...override.provider },
    agent: { ...base.agent, ...override.agent },
    mcp: { ...base.mcp, ...override.mcp },
    permission: override.permission ?? base.permission,
  })
}
