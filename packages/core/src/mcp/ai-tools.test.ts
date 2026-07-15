import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, mergeConfig, type AppConfig } from '../config/schema.js'
import { buildRunRuleset, PermissionEngine } from '../permission/index.js'
import { createMcpAiSdkTools, mcpAiToolName } from './ai-tools.js'
import type { RemoteMcpRegistry } from './registry.js'
import type { McpDiscovery } from './types.js'

function app(mode: AppConfig['executionMode'] = 'auto') {
  return mergeConfig(DEFAULT_CONFIG, {
    executionMode: mode,
    mcp: {
      docs: {
        name: 'Docs',
        url: 'https://mcp.example.test/mcp',
        enabled: true,
      },
    },
  })
}

const discovery: McpDiscovery = {
  serverId: 'docs',
  serverName: 'Docs',
  protocolVersion: '2025-11-25',
  transport: 'streamable-http',
  discoveredAt: 1,
  tools: [
    {
      name: 'lookup',
      description: 'Read',
      inputSchema: { type: 'object' },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    {
      name: 'delete',
      description: 'Delete',
      inputSchema: { type: 'object' },
      annotations: { destructiveHint: true },
    },
  ],
  resources: [],
  prompts: [],
}

function fakeRegistry(current: { config: AppConfig }) {
  return {
    getCachedDiscovery: vi.fn().mockResolvedValue(discovery),
    discover: vi.fn().mockResolvedValue(discovery),
    getConfig: vi.fn(async () => current.config),
    callTool: vi.fn(async (serverId, toolName) => ({
      _mcp: { serverId, serverName: 'Docs', toolName, isError: false },
      content: [{ type: 'text', text: 'ok' }],
    })),
  } as unknown as RemoteMcpRegistry
}

function execute(tool: unknown, args: unknown): Promise<unknown> {
  return (tool as { execute: (args: unknown) => Promise<unknown> }).execute(args)
}

describe('MCP AI SDK tools', () => {
  it('uses deterministic collision-safe names', () => {
    expect(mcpAiToolName('docs', 'lookup')).toBe('docs__lookup')
    expect(mcpAiToolName('docs', 'look up')).toBe('docs__look_up')
    expect(mcpAiToolName('docs', 'look up', new Set(['docs__look_up']))).toMatch(
      /^docs__look_up__[a-z0-9]+$/,
    )
  })

  it('allows annotated reads in auto mode and asks for destructive/open-world calls', async () => {
    const current = { config: app('auto') }
    const registry = fakeRegistry(current)
    const permission = new PermissionEngine()
    const ruleset = buildRunRuleset({
      executionMode: 'auto',
      userPermission: current.config.permission,
    })
    const converted = await createMcpAiSdkTools({
      registry,
      appConfig: current.config,
      permission,
      ruleset,
      sessionId: 'session',
    })

    await expect(execute(converted.tools.docs__lookup, {})).resolves.toMatchObject({
      _mcp: { toolName: 'lookup' },
    })
    expect(permission.listPending()).toEqual([])

    const destructive = execute(converted.tools.docs__delete, {})
    await Promise.resolve()
    const pending = permission.listPending()
    expect(pending).toHaveLength(1)
    expect(pending[0]).toMatchObject({
      permission: 'mcp.docs.delete',
      patterns: ['https://mcp.example.test/mcp'],
    })
    permission.reply({ id: pending[0]!.id, response: 'once' })
    await expect(destructive).resolves.toMatchObject({ _mcp: { toolName: 'delete' } })
  })

  it('blocks non-read-only tools in plan mode and enforces live enable changes', async () => {
    const current = { config: app('plan') }
    const registry = fakeRegistry(current)
    const converted = await createMcpAiSdkTools({
      registry,
      appConfig: current.config,
      permission: new PermissionEngine(),
      ruleset: buildRunRuleset({
        executionMode: 'plan',
        userPermission: current.config.permission,
      }),
      sessionId: 'session',
    })
    expect(Object.keys(converted.tools)).toEqual(['docs__lookup'])

    current.config = mergeConfig(current.config, {
      mcp: { docs: { tools: { lookup: { enabled: false } } } },
    })
    await expect(execute(converted.tools.docs__lookup, {})).rejects.toThrow(/disabled/)
  })
})
