import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, type AppConfig } from '../config/schema.js'
import { getAgent, listAgents, listVisibleAgents } from './index.js'

describe('agent definitions', () => {
  it('lists built-in agents from default config', () => {
    const agents = listAgents()
    const names = agents.map((agent) => agent.name)
    expect(names).toContain('browse')
    expect(names).toContain('act')
    expect(names).toContain('explore')
    expect(names).toContain('compact')
    expect(names).toContain('title')
  })

  it('merges user agent overrides onto defaults', () => {
    const config: AppConfig = {
      ...DEFAULT_CONFIG,
      agent: {
        browse: {
          description: 'Custom browse label',
          steps: 12,
        },
        custom: {
          description: 'User-defined agent',
          mode: 'primary',
          prompt: 'Do custom things',
        },
      },
    }

    const browse = getAgent('browse', config)
    expect(browse?.description).toBe('Custom browse label')
    expect(browse?.steps).toBe(12)
    expect(browse?.prompt).toContain('browser research assistant')
    expect(browse?.permission.some((rule) => rule.action === 'deny')).toBe(true)

    const custom = getAgent('custom', config)
    expect(custom?.description).toBe('User-defined agent')
    expect(custom?.mode).toBe('primary')
  })

  it('filters hidden, disabled, and subagent modes from visible list', () => {
    const visible = listVisibleAgents()
    const names = visible.map((agent) => agent.name)
    expect(names).toEqual(expect.arrayContaining(['browse', 'act']))
    expect(names).not.toContain('explore')
    expect(names).not.toContain('compact')
    expect(names).not.toContain('title')
  })

  it('respects hidden and disable overrides in visible list', () => {
    const config: AppConfig = {
      ...DEFAULT_CONFIG,
      agent: {
        act: { hidden: true },
        browse: { disable: true },
        explore: { mode: 'all' },
      },
    }

    const visible = listVisibleAgents(config)
    const names = visible.map((agent) => agent.name)
    expect(names).not.toContain('act')
    expect(names).not.toContain('browse')
    expect(names).toContain('explore')
  })
})
