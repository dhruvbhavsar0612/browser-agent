export const MCP_PROTOCOL_VERSION = '2025-11-25'

export type McpTransportKind = 'streamable-http' | 'sse'

export interface McpToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpDiscoveredTool {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: McpToolAnnotations
}

export interface McpDiscoveredResource {
  uri: string
  name: string
  title?: string
  description?: string
  mimeType?: string
}

export interface McpDiscoveredPrompt {
  name: string
  title?: string
  description?: string
  arguments?: Array<{ name: string; description?: string; required?: boolean }>
}

export interface McpDiscovery {
  serverId: string
  serverName: string
  serverVersion?: { name: string; version: string }
  protocolVersion: string
  transport: McpTransportKind
  discoveredAt: number
  tools: McpDiscoveredTool[]
  resources: McpDiscoveredResource[]
  prompts: McpDiscoveredPrompt[]
  warnings?: string[]
}

export type McpHealthErrorCode =
  'auth' | 'cors' | 'network' | 'protocol' | 'transport' | 'configuration' | 'server'

export interface McpHealth {
  ok: boolean
  serverId: string
  checkedAt: number
  transport?: McpTransportKind
  serverVersion?: { name: string; version: string }
  protocolVersion?: string
  latencyMs?: number
  error?: { code: McpHealthErrorCode; message: string; detail?: string }
}

export interface NormalizedMcpToolResult {
  _mcp: {
    serverId: string
    serverName: string
    toolName: string
    isError: boolean
  }
  content: unknown[]
  structuredContent?: unknown
  summary?: string
  urls?: string[]
  truncated?: boolean
  originalChars?: number
  error?: string
}

export interface McpMarketplaceConnector {
  id: string
  name: string
  description: string
  version: string
  url: string
  transport: 'streamable-http' | 'sse'
  authMode: 'none' | 'bearer' | 'api-key' | 'oauth'
  provenance: {
    provider: 'official-mcp' | 'smithery' | 'glama' | 'manual'
    sourceUrl?: string
    sourceId?: string
  }
  manifest: Record<string, unknown>
}
