import { jsonSchema, tool, type ToolSet } from 'ai'
import type { AppConfig, McpServerConfig, PermissionConfig } from '../config/schema.js'
import { fromConfig, type PermissionEngine, type PermissionRuleEntry } from '../permission/index.js'
import type { RemoteMcpRegistry } from './registry.js'
import type { McpDiscoveredTool, McpToolAnnotations } from './types.js'

export interface McpAiToolMetadata {
  aiName: string
  serverId: string
  serverName: string
  serverUrl: string
  toolName: string
  title?: string
  annotations?: McpToolAnnotations
}

export interface McpAiToolsResult {
  tools: ToolSet
  metadata: Record<string, McpAiToolMetadata>
  errors: Array<{ serverId: string; message: string }>
}

function stableHash(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function safeName(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return normalized || 'mcp'
}

export function mcpAiToolName(
  serverId: string,
  toolName: string,
  occupied: ReadonlySet<string> = new Set(),
): string {
  const base = `${safeName(serverId)}__${safeName(toolName)}`
  if (!occupied.has(base)) return base
  return `${base}__${stableHash(`${serverId}\0${toolName}`).slice(0, 7)}`
}

export function isMcpToolReadOnly(annotations: McpToolAnnotations | undefined): boolean {
  return (
    annotations?.readOnlyHint === true &&
    annotations.destructiveHint !== true &&
    annotations.openWorldHint !== true
  )
}

function explicitUserRules(
  mode: AppConfig['executionMode'],
  permission: PermissionConfig,
): PermissionRuleEntry[] {
  const rules = fromConfig(permission)
  if (mode !== 'auto') return rules
  return rules.filter(
    (rule) => !(rule.permission === '*' && rule.pattern === '*' && rule.action === 'ask'),
  )
}

function callRules(
  base: PermissionRuleEntry[],
  appConfig: AppConfig,
  permission: string,
  url: string,
  annotations: McpToolAnnotations | undefined,
): PermissionRuleEntry[] {
  const needsRiskAsk = !isMcpToolReadOnly(annotations)
  return [
    ...base,
    ...(needsRiskAsk ? [{ permission, pattern: url, action: 'ask' as const }] : []),
    ...explicitUserRules(appConfig.executionMode, appConfig.permission),
  ]
}

async function discoveryForServer(
  registry: RemoteMcpRegistry,
  serverId: string,
): Promise<McpDiscoveredTool[]> {
  const cached = await registry.getCachedDiscovery(serverId)
  if (cached) return cached.tools
  return (await registry.discover(serverId)).tools
}

export async function createMcpAiSdkTools(input: {
  registry: RemoteMcpRegistry
  appConfig: AppConfig
  permission: PermissionEngine
  ruleset: PermissionRuleEntry[]
  sessionId: string
  signal?: AbortSignal
  maxResultChars?: number
  occupiedNames?: Iterable<string>
}): Promise<McpAiToolsResult> {
  const tools: ToolSet = {}
  const metadata: Record<string, McpAiToolMetadata> = {}
  const errors: McpAiToolsResult['errors'] = []
  const occupied = new Set(input.occupiedNames ?? [])

  for (const [serverId, server] of Object.entries(input.appConfig.mcp)) {
    if (!server.enabled) continue
    let discovered: McpDiscoveredTool[]
    try {
      discovered = await discoveryForServer(input.registry, serverId)
    } catch (error) {
      errors.push({
        serverId,
        message: error instanceof Error ? error.message : String(error),
      })
      continue
    }

    for (const remoteTool of discovered) {
      if (server.tools[remoteTool.name]?.enabled === false) continue
      if (input.appConfig.executionMode === 'plan' && !isMcpToolReadOnly(remoteTool.annotations)) {
        continue
      }
      const aiName = mcpAiToolName(serverId, remoteTool.name, occupied)
      occupied.add(aiName)
      const permissionName = `mcp.${serverId}.${remoteTool.name}`
      const toolMetadata: McpAiToolMetadata = {
        aiName,
        serverId,
        serverName: server.name ?? serverId,
        serverUrl: server.url,
        toolName: remoteTool.name,
        ...(remoteTool.title ? { title: remoteTool.title } : {}),
        ...(remoteTool.annotations ? { annotations: remoteTool.annotations } : {}),
      }
      metadata[aiName] = toolMetadata
      tools[aiName] = tool({
        description:
          remoteTool.description ?? `Remote MCP tool ${server.name ?? serverId}/${remoteTool.name}`,
        inputSchema: jsonSchema(remoteTool.inputSchema),
        execute: async (args) => {
          const latestServer: McpServerConfig | undefined = (await input.registry.getConfig()).mcp[
            serverId
          ]
          if (!latestServer?.enabled || latestServer.tools[remoteTool.name]?.enabled === false) {
            throw new Error(`MCP tool "${serverId}/${remoteTool.name}" was disabled`)
          }
          if (
            input.appConfig.executionMode === 'plan' &&
            !isMcpToolReadOnly(remoteTool.annotations)
          ) {
            throw new Error('Plan mode blocks MCP tools that are not explicitly read-only')
          }
          await input.permission.ask({
            sessionID: input.sessionId,
            permission: permissionName,
            patterns: [server.url],
            metadata: {
              kind: 'mcp',
              server: { id: serverId, name: server.name ?? serverId, url: server.url },
              tool: {
                name: remoteTool.name,
                title: remoteTool.title,
                annotations: remoteTool.annotations,
              },
              args,
            },
            ruleset: callRules(
              input.ruleset,
              input.appConfig,
              permissionName,
              server.url,
              remoteTool.annotations,
            ),
          })
          return input.registry.callTool(
            serverId,
            remoteTool.name,
            (args ?? {}) as Record<string, unknown>,
            { signal: input.signal, maxResultChars: input.maxResultChars },
          )
        },
      })
    }
  }

  return { tools, metadata, errors }
}
