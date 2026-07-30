export type McpServerPresetCategory = 'web-search' | 'docs' | 'devtools' | 'project' | 'other'

export type McpServerPresetAuthMode = 'none' | 'bearer' | 'api-key' | 'oauth'

/**
 * A documented, non-secret authentication decision for a hosted MCP preset.
 * `authMode` remains the creation default for compatibility; this metadata
 * explains the approved alternatives without storing any credential material.
 */
export type McpServerPresetAuthStrategy = {
  preferred: McpServerPresetAuthMode
  alternatives: McpServerPresetAuthMode[]
  setup: string
}

export type McpServerPreset = {
  id: string
  name: string
  description: string
  category: McpServerPresetCategory
  url: string
  transport?: 'auto' | 'streamable-http' | 'sse'
  authMode: McpServerPresetAuthMode
  authStrategy: McpServerPresetAuthStrategy
  docsUrl?: string
  tags: string[]
  requiresUserUrl?: boolean
  setupHint?: string
}

const MCP_SERVER_PRESETS: readonly McpServerPreset[] = [
  {
    id: 'context7-docs',
    name: 'Context7 Docs',
    description:
      'Look up current, version-specific library documentation and examples from Context7.',
    category: 'docs',
    url: 'https://mcp.context7.com/mcp',
    transport: 'streamable-http',
    authMode: 'none',
    authStrategy: {
      preferred: 'none',
      alternatives: ['api-key'],
      setup:
        'Use anonymous access first. If Context7 issues a credential for higher limits, save it as an API-key vault secret; never add it to headers.',
    },
    docsUrl: 'https://context7.com/docs/resources/all-clients',
    tags: ['documentation', 'libraries', 'code-examples', 'open-world'],
    setupHint:
      'Anonymous access is supported. Add a Context7 API key later if you need higher limits.',
  },
  {
    id: 'github-official',
    name: 'GitHub',
    description: 'Use the official GitHub remote MCP server for repository and pull request work.',
    category: 'project',
    url: 'https://api.githubcopilot.com/mcp/',
    transport: 'streamable-http',
    authMode: 'bearer',
    authStrategy: {
      preferred: 'bearer',
      alternatives: ['oauth'],
      setup:
        'Use a least-privilege GitHub fine-grained PAT as a bearer credential. OAuth is only a fallback when the selected GitHub MCP deployment explicitly supports it.',
    },
    docsUrl: 'https://github.com/github/github-mcp-server',
    tags: ['git', 'github', 'repositories', 'pull-requests', 'issues'],
    setupHint:
      'Recommended: save a least-privilege GitHub fine-grained PAT as the bearer credential. Use OAuth only when the selected GitHub MCP deployment supports it.',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Search and update Linear issues, projects, cycles, documents, teams, and users.',
    category: 'project',
    url: 'https://mcp.linear.app/mcp',
    transport: 'streamable-http',
    authMode: 'oauth',
    authStrategy: {
      preferred: 'oauth',
      alternatives: [],
      setup: 'Connect with OAuth and approve the requested Linear workspace access.',
    },
    docsUrl: 'https://linear.app/docs/mcp',
    tags: ['linear', 'issues', 'projects', 'planning', 'workspace', 'oauth'],
    setupHint: 'Connect with OAuth to authorize access to your Linear workspace.',
  },
  {
    id: 'notion',
    name: 'Notion',
    description:
      'Search, read, and update Notion pages, databases, comments, and workspace content.',
    category: 'docs',
    url: 'https://mcp.notion.com/mcp',
    transport: 'streamable-http',
    authMode: 'oauth',
    authStrategy: {
      preferred: 'oauth',
      alternatives: [],
      setup: 'Connect with OAuth and approve the requested Notion workspace access.',
    },
    docsUrl: 'https://developers.notion.com/guides/mcp/get-started-with-mcp',
    tags: ['notion', 'docs', 'workspace', 'databases', 'oauth'],
    setupHint: 'Connect with OAuth and approve the workspace content this MCP server can access.',
  },
  {
    id: 'sentry',
    name: 'Sentry',
    description:
      'Investigate Sentry projects, issues, traces, releases, stack traces, and Seer analysis.',
    category: 'devtools',
    url: 'https://mcp.sentry.dev/mcp',
    transport: 'streamable-http',
    authMode: 'oauth',
    authStrategy: {
      preferred: 'oauth',
      alternatives: ['bearer', 'api-key'],
      setup:
        'Use OAuth when available. For a self-hosted or token-based Sentry deployment, save the provider-documented credential in the MCP vault instead of headers.',
    },
    docsUrl: 'https://github.com/getsentry/sentry-mcp',
    tags: ['sentry', 'errors', 'observability', 'debugging', 'oauth'],
    setupHint:
      'Connect with OAuth, or switch to a custom Authorization header if your Sentry setup requires a token.',
  },
  {
    id: 'custom-remote',
    name: 'Custom Remote MCP',
    description: 'Add a hosted remote MCP server by pasting its HTTPS endpoint URL.',
    category: 'other',
    url: '',
    transport: 'auto',
    authMode: 'none',
    authStrategy: {
      preferred: 'none',
      alternatives: ['bearer', 'api-key', 'oauth'],
      setup:
        'Start with the provider-documented mode. Save bearer/API-key values only in the MCP vault; use OAuth when the remote server advertises OAuth metadata.',
    },
    tags: ['custom', 'remote', 'https'],
    requiresUserUrl: true,
    setupHint:
      'Paste the remote MCP URL from the provider, such as a ChatGPT or Claude custom connector URL. Only HTTPS endpoints are supported.',
  },
]

function copyPreset(preset: McpServerPreset): McpServerPreset {
  return {
    ...preset,
    authStrategy: {
      ...preset.authStrategy,
      alternatives: [...preset.authStrategy.alternatives],
    },
    tags: [...preset.tags],
  }
}

export function listMcpPresets(): McpServerPreset[] {
  return MCP_SERVER_PRESETS.map(copyPreset)
}

export function searchMcpPresets(query: string): McpServerPreset[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return listMcpPresets()

  return MCP_SERVER_PRESETS.filter((preset) => {
    const haystack = [preset.name, preset.description, ...preset.tags].join(' ').toLowerCase()
    return haystack.includes(normalizedQuery)
  }).map(copyPreset)
}
