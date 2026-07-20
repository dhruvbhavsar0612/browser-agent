import { z } from 'zod'

export const PermissionAction = z.enum(['allow', 'ask', 'deny'])
export type PermissionAction = z.infer<typeof PermissionAction>

export const PermissionRule = z.union([PermissionAction, z.record(z.string(), PermissionAction)])
export type PermissionRule = z.infer<typeof PermissionRule>

export const PermissionConfig = z.union([
  PermissionAction,
  z
    .object({
      page_read: PermissionRule.optional(),
      grep_page: PermissionRule.optional(),
      click: PermissionRule.optional(),
      type: PermissionRule.optional(),
      scroll: PermissionRule.optional(),
      hover: PermissionRule.optional(),
      select: PermissionRule.optional(),
      navigate: PermissionRule.optional(),
      tabs: PermissionRule.optional(),
      tab_focus: PermissionRule.optional(),
      tab_open: PermissionRule.optional(),
      tab_close: PermissionRule.optional(),
      screenshot: PermissionRule.optional(),
      evaluate: PermissionRule.optional(),
      webfetch: PermissionRule.optional(),
      doom_loop: PermissionAction.optional(),
      echo: PermissionAction.optional(),
      get_time: PermissionAction.optional(),
      task: PermissionRule.optional(),
      '*': PermissionAction.optional(),
    })
    .catchall(PermissionRule),
])
export type PermissionConfig = z.infer<typeof PermissionConfig>

/** Reasoning effort levels aligned with OpenAI's reasoning_effort parameter. */
export const ReasoningEffort = z.enum(['none', 'low', 'medium', 'high'])
export type ReasoningEffort = z.infer<typeof ReasoningEffort>

export const ProviderModelConfig = z.object({
  name: z.string().optional(),
  tool_call: z.boolean().optional(),
  enabled: z.boolean().default(false),
  /**
   * Controls the model's reasoning/thinking effort when the model supports it
   * (e.g. OpenAI o-series, Anthropic Claude with extended thinking).
   * 'none' disables reasoning even if the model supports it by default.
   */
  reasoning_effort: ReasoningEffort.optional(),
})
export type ProviderModelConfig = z.infer<typeof ProviderModelConfig>

export const ProviderConfig = z.object({
  enabled: z.boolean().default(false),
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
  models: z.record(z.string(), ProviderModelConfig).default({}),
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

const SECRET_HEADER_NAME = /^(authorization|proxy-authorization|x-api-key|api-key|x-auth-token)$/i

export function isSecureRemoteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return (
      url.protocol === 'http:' &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]')
    )
  } catch {
    return false
  }
}

export const McpToolConfig = z.object({
  enabled: z.boolean().default(true),
})
export type McpToolConfig = z.infer<typeof McpToolConfig>

export const McpAuthConfig = z
  .object({
    mode: z.enum(['none', 'bearer', 'api-key', 'oauth']).default('none'),
    /** Header name only. Its value always lives in the encrypted MCP vault namespace. */
    headerName: z.string().min(1).max(128).optional(),
  })
  .default({ mode: 'none' })
export type McpAuthConfig = z.infer<typeof McpAuthConfig>

export const McpServerConfig = z
  .object({
    type: z.enum(['remote']).default('remote'),
    name: z.string().min(1).max(100).optional(),
    url: z
      .string()
      .url()
      .refine(
        isSecureRemoteUrl,
        'Remote MCP URL must use HTTPS (HTTP is allowed for localhost only)',
      ),
    transport: z.enum(['auto', 'streamable-http', 'sse']).default('auto'),
    headers: z
      .record(z.string().min(1), z.string())
      .default({})
      .superRefine((headers, ctx) => {
        for (const name of Object.keys(headers)) {
          if (SECRET_HEADER_NAME.test(name)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: [name],
              message: 'Secret header values must be stored in the encrypted MCP credential vault',
            })
          }
        }
      }),
    auth: McpAuthConfig,
    enabled: z.boolean().default(true),
    tools: z.record(z.string(), McpToolConfig).default({}),
    provenance: z
      .object({
        provider: z.enum(['official-mcp', 'smithery', 'glama', 'manual']),
        sourceUrl: z.string().url().optional(),
        sourceId: z.string().optional(),
        version: z.string().optional(),
      })
      .optional(),
  })
  .strict()
export type McpServerConfig = z.infer<typeof McpServerConfig>

export const CompactionConfig = z.object({
  fallbackContextTokens: z.number().int().min(8_192).default(32_768),
  threshold: z.number().min(0.7).max(0.75).default(0.72),
  reserveTokens: z.number().int().min(1_024).default(4_096),
  recentTurns: z.number().int().min(1).default(6),
  maxToolResultChars: z.number().int().min(1_000).default(12_000),
})
export type CompactionConfig = z.infer<typeof CompactionConfig>

export const AppConfig = z
  .object({
    model: z.string().optional(),
    small_model: z.string().optional(),
    provider: z.record(z.string(), ProviderConfig).default({}),
    agent: z.record(z.string(), AgentConfig).default({}),
    permission: PermissionConfig.default({ '*': 'ask' }),
    mcp: z.record(z.string(), McpServerConfig).default({}),
    compaction: CompactionConfig.default({
      fallbackContextTokens: 32_768,
      threshold: 0.72,
      reserveTokens: 4_096,
      recentTurns: 6,
      maxToolResultChars: 12_000,
    }),
    executionMode: z.enum(['plan', 'approval', 'auto']).default('approval'),
  })
  .superRefine((config, ctx) => {
    if (!config.model) return
    const slash = config.model.indexOf('/')
    if (slash <= 0 || slash === config.model.length - 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'Default model must use providerID/modelID format',
      })
      return
    }
    const providerID = config.model.slice(0, slash)
    const modelID = config.model.slice(slash + 1)
    const provider = config.provider[providerID]
    if (provider?.enabled !== true || provider.models[modelID]?.enabled !== true) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['model'],
        message: 'Default model must belong to an enabled provider and be enabled',
      })
    }
  })
export type AppConfig = z.infer<typeof AppConfig>
export type ExecutionMode = AppConfig['executionMode']

export type ProviderConfigPatch = Partial<Omit<ProviderConfig, 'api' | 'models' | 'options'>> & {
  api?: string | null
  options?: ProviderConfig['options']
  models?: Record<string, Partial<ProviderModelConfig>>
}

export type McpServerConfigPatch = Partial<Omit<McpServerConfig, 'tools'>> & {
  tools?: Record<string, Partial<McpToolConfig>>
}

export type AppConfigPatch = Omit<Partial<AppConfig>, 'model' | 'provider' | 'mcp'> & {
  /** null explicitly clears the default across JSON/chrome messaging boundaries. */
  model?: string | null
  provider?: Record<string, ProviderConfigPatch>
  /** A null server removes it. Other entries merge to preserve per-tool choices. */
  mcp?: Record<string, McpServerConfigPatch | null>
}

export const DEFAULT_CONFIG: AppConfig = {
  provider: {},
  agent: {
    browse: {
      description: 'Read-only research and extraction',
      mode: 'primary',
      prompt: `You are a browser research assistant. Your job is to read, summarize, and extract information from web pages without changing them.

Capabilities:
- Read page content and list open tabs
- Compare information across tabs
- Answer questions using what is visible on screen

Restrictions:
- Do not click, type, navigate, or otherwise modify the browser
- If the user asks you to take an action, explain what you found and suggest they switch to the Act agent

Be concise, cite specific page content when possible, and ask clarifying questions when the task is ambiguous.`,
      steps: 20,
      permission: {
        page_read: 'allow',
        grep_page: 'allow',
        tabs: 'allow',
        tab_focus: 'allow',
        tab_open: 'ask',
        tab_close: 'ask',
        screenshot: 'ask',
        click: 'deny',
        type: 'deny',
        scroll: 'deny',
        hover: 'deny',
        select: 'deny',
        navigate: 'deny',
        echo: 'allow',
        get_time: 'allow',
      },
    },
    act: {
      description: 'Full browser automation',
      mode: 'primary',
      prompt: `You are a browser automation agent. You can interact with web pages to complete tasks on the user's behalf.

Capabilities:
- Read pages, click elements, type text, and navigate
- Manage tabs and focus as needed
- Break complex tasks into clear steps

Guidelines:
- Confirm destructive or irreversible actions when uncertain
- Prefer stable selectors and describe what you are doing
- Stop and report if you are blocked, logged out, or stuck in a loop`,
      steps: 30,
      permission: {
        '*': 'ask',
        page_read: 'allow',
        grep_page: 'allow',
        tabs: 'allow',
        tab_focus: 'allow',
        click: 'ask',
        type: 'ask',
        scroll: 'ask',
        hover: 'ask',
        select: 'ask',
        navigate: 'ask',
        screenshot: 'ask',
        tab_open: 'ask',
        tab_close: 'ask',
        echo: 'allow',
        get_time: 'allow',
      },
    },
    explore: {
      description: 'Fast multi-tab reconnaissance',
      mode: 'subagent',
      prompt: `You are a reconnaissance subagent. Quickly survey open tabs and relevant pages to gather context for a parent agent.

Capabilities:
- Read page content across multiple tabs
- Summarize what each tab contains and how they relate

Restrictions:
- Read-only: do not click, type, or navigate
- Return a compact briefing: key facts, URLs, and suggested next steps`,
      steps: 20,
      permission: {
        page_read: 'allow',
        grep_page: 'allow',
        tabs: 'allow',
        tab_focus: 'allow',
        tab_open: 'ask',
        tab_close: 'ask',
        screenshot: 'ask',
        click: 'deny',
        type: 'deny',
        scroll: 'deny',
        hover: 'deny',
        select: 'deny',
        navigate: 'deny',
      },
    },
    compact: {
      description: 'Compress conversation context',
      mode: 'subagent',
      hidden: true,
      prompt:
        'Summarize the conversation so far into a short, information-dense recap. Preserve decisions, URLs, and open questions.',
      steps: 5,
      permission: { '*': 'deny' },
    },
    title: {
      description: 'Generate a short chat title',
      mode: 'subagent',
      hidden: true,
      prompt:
        'Generate a short title (3–6 words) for this conversation. Reply with the title only, no quotes.',
      steps: 3,
      permission: { '*': 'deny' },
    },
  },
  permission: { '*': 'ask' },
  mcp: {},
  compaction: {
    fallbackContextTokens: 32_768,
    threshold: 0.72,
    reserveTokens: 4_096,
    recentTurns: 6,
    maxToolResultChars: 12_000,
  },
  executionMode: 'approval',
}

export function parseConfig(input: unknown): AppConfig {
  return AppConfig.parse(input)
}

export function isProviderEnabled(config: AppConfig, providerID: string): boolean {
  return config.provider[providerID]?.enabled === true
}

export function isModelEnabled(config: AppConfig, providerID: string, modelID: string): boolean {
  const provider = config.provider[providerID]
  return provider?.enabled === true && provider.models[modelID]?.enabled === true
}

function mergeProviders(
  base: AppConfig['provider'],
  patch: AppConfigPatch['provider'],
): AppConfig['provider'] {
  const merged: Record<string, ProviderConfig> = { ...base }
  for (const [providerID, providerPatch] of Object.entries(patch ?? {})) {
    const current = base[providerID]
    const normalizedPatch = {
      ...providerPatch,
      api: providerPatch.api === null ? undefined : providerPatch.api,
    }
    const models = { ...(current?.models ?? {}) }
    for (const [modelID, modelPatch] of Object.entries(providerPatch.models ?? {})) {
      models[modelID] = {
        enabled: false,
        ...models[modelID],
        ...modelPatch,
      }
    }
    merged[providerID] = {
      enabled: false,
      ...current,
      ...normalizedPatch,
      options:
        current?.options || providerPatch.options
          ? { ...current?.options, ...providerPatch.options }
          : undefined,
      models,
    }
  }
  return merged
}

function mergeMcp(base: AppConfig['mcp'], patch: AppConfigPatch['mcp']): AppConfig['mcp'] {
  const merged: Record<string, McpServerConfig> = { ...base }
  for (const [serverId, serverPatch] of Object.entries(patch ?? {})) {
    if (serverPatch === null) {
      delete merged[serverId]
      continue
    }
    const current = base[serverId]
    merged[serverId] = McpServerConfig.parse({
      ...current,
      ...serverPatch,
      headers: serverPatch.headers ?? current?.headers ?? {},
      auth: { ...current?.auth, ...serverPatch.auth },
      tools: { ...current?.tools, ...serverPatch.tools },
    })
  }
  return merged
}

export function mergeConfig(base: AppConfig, override: AppConfigPatch): AppConfig {
  const model =
    override.model === null ? undefined : override.model !== undefined ? override.model : base.model
  return parseConfig({
    ...base,
    ...override,
    model,
    provider: mergeProviders(base.provider, override.provider),
    agent: { ...base.agent, ...override.agent },
    mcp: mergeMcp(base.mcp, override.mcp),
    compaction: { ...base.compaction, ...override.compaction },
    permission: override.permission ?? base.permission,
  })
}
