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
  it('lists registered tools', () => {
    const tools = listTools()
    expect(tools.map((tool) => tool.id)).toEqual([
      'echo',
      'get_time',
      'tabs_list',
      'tabs_focus',
      'tabs_open',
      'tabs_close',
      'navigate',
      'page_read',
      'page_grep',
      'page_screenshot',
      'click',
      'type',
      'scroll',
      'hover',
      'select',
    ])
  })

  it('filters denied tools by permission rules', () => {
    const denyAll = fromConfig({ '*': 'deny', echo: 'allow' })
    const filtered = filterToolsByPermission(listTools(), denyAll)
    expect(filtered.map((tool) => tool.id)).toEqual(['echo'])
    expect(isToolAvailable(getTimeTool, denyAll)).toBe(false)
    expect(isToolAvailable(echoTool, denyAll)).toBe(true)
  })

  it('allows act agent tools by default permission rules', () => {
    const actRules = fromConfig(DEFAULT_CONFIG.agent.act?.permission ?? {})
    const ids = filterToolsByPermission(listTools(), actRules).map((tool) => tool.id)
    expect(ids).toContain('click')
    expect(ids).toContain('type')
    expect(ids).toContain('scroll')
    expect(ids).toContain('hover')
    expect(ids).toContain('select')
    expect(ids).toContain('navigate')
  })

  it('allows browse agent tools by default permission rules', () => {
    const browseRules = fromConfig(DEFAULT_CONFIG.agent.browse?.permission ?? {})
    expect(filterToolsByPermission(listTools(), browseRules).map((tool) => tool.id)).toEqual([
      'echo',
      'get_time',
      'tabs_list',
      'tabs_focus',
      'tabs_open',
      'tabs_close',
      'page_read',
      'page_grep',
      'page_screenshot',
    ])
    expect(filterToolsByPermission(listTools(), browseRules).map((tool) => tool.id)).not.toContain(
      'navigate',
    )
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
