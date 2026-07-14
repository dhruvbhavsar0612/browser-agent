import { describe, expect, it, vi } from 'vitest'
import { fromConfig } from '../permission/index.js'
import { DEFAULT_CONFIG } from '../config/schema.js'
import {
  echoTool,
  filterToolsByPermission,
  getTimeTool,
  isToolAvailable,
  listTools,
  toAiSdkTools,
} from './index.js'

describe('tools', () => {
  it('lists stub tools', () => {
    const tools = listTools()
    expect(tools.map((tool) => tool.id)).toEqual(['echo', 'get_time'])
  })

  it('filters denied tools by permission rules', () => {
    const denyAll = fromConfig({ '*': 'deny', echo: 'allow' })
    const filtered = filterToolsByPermission(listTools(), denyAll)
    expect(filtered.map((tool) => tool.id)).toEqual(['echo'])
    expect(isToolAvailable(getTimeTool, denyAll)).toBe(false)
    expect(isToolAvailable(echoTool, denyAll)).toBe(true)
  })

  it('allows stub tools for browse agent defaults', () => {
    const browseRules = fromConfig(DEFAULT_CONFIG.agent.browse?.permission ?? {})
    expect(filterToolsByPermission(listTools(), browseRules).map((tool) => tool.id)).toEqual([
      'echo',
      'get_time',
    ])
  })

  it('converts tools to AI SDK tools and executes with permission ask', async () => {
    const ask = vi.fn(async () => undefined)
    const tools = toAiSdkTools([echoTool], {
      sessionId: 'sess-1',
      ask,
    })

    expect(tools.echo).toBeDefined()
    const echo = tools.echo
    expect(echo).toBeDefined()
    if (!echo || !('execute' in echo) || typeof echo.execute !== 'function') {
      throw new Error('echo tool execute missing')
    }
    const result = await echo.execute(
      { text: 'hi' },
      {
        toolCallId: 'c1',
        messages: [],
      },
    )
    expect(ask).toHaveBeenCalledWith({
      permission: 'echo',
      patterns: ['*'],
      metadata: { tool: 'echo', args: { text: 'hi' } },
    })
    expect(result).toEqual({ echoed: 'hi' })
  })
})
