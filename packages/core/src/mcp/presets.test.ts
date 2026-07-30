import { describe, expect, it } from 'vitest'
import { listMcpPresets, searchMcpPresets } from './presets.js'

describe('MCP presets', () => {
  it('lists the curated presets in a stable order', () => {
    expect(listMcpPresets().map((preset) => preset.id)).toEqual([
      'context7-docs',
      'github-official',
      'linear',
      'notion',
      'sentry',
      'custom-remote',
    ])
  })

  it('keeps hosted presets remote-only with HTTPS URLs', () => {
    for (const preset of listMcpPresets()) {
      if (preset.requiresUserUrl) {
        expect(preset.url).toBe('')
        expect(preset.setupHint).toContain('HTTPS')
        continue
      }

      expect(preset.url).toMatch(/^https:\/\//)
      expect(preset.transport).toMatch(/^(auto|streamable-http|sse)$/)
    }
  })

  it('captures known auth expectations for common presets', () => {
    expect(listMcpPresets()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'context7-docs',
          url: 'https://mcp.context7.com/mcp',
          authMode: 'none',
          authStrategy: expect.objectContaining({
            preferred: 'none',
            alternatives: expect.arrayContaining(['api-key']),
          }),
        }),
        expect.objectContaining({
          id: 'github-official',
          url: 'https://api.githubcopilot.com/mcp/',
          authMode: 'bearer',
          authStrategy: expect.objectContaining({
            preferred: 'bearer',
            alternatives: ['oauth'],
          }),
        }),
        expect.objectContaining({
          id: 'linear',
          url: 'https://mcp.linear.app/mcp',
          authMode: 'oauth',
        }),
        expect.objectContaining({
          id: 'notion',
          url: 'https://mcp.notion.com/mcp',
          authMode: 'oauth',
        }),
        expect.objectContaining({
          id: 'sentry',
          url: 'https://mcp.sentry.dev/mcp',
          authMode: 'oauth',
        }),
      ]),
    )
  })

  it('provides a concrete non-secret auth strategy for every preset', () => {
    for (const preset of listMcpPresets()) {
      expect(preset.authStrategy.preferred).toBe(preset.authMode)
      expect(preset.authStrategy.setup).not.toMatch(
        /\b(?:token|secret|pat)\s*[:=]\s*\S+/i,
      )
    }
  })

  it('searches name, description, and tags case-insensitively', () => {
    expect(searchMcpPresets('github').map((preset) => preset.id)).toEqual(['github-official'])
    expect(searchMcpPresets('OBSERVABILITY').map((preset) => preset.id)).toEqual(['sentry'])
    expect(searchMcpPresets('workspace').map((preset) => preset.id)).toEqual(['linear', 'notion'])
  })

  it('returns defensive copies', () => {
    const first = listMcpPresets()[0]
    expect(first).toBeDefined()
    if (!first) throw new Error('Expected at least one MCP preset')

    first.name = 'Changed'
    first.tags.push('mutated')
    first.authStrategy.alternatives.push('bearer')

    expect(listMcpPresets()[0]).toMatchObject({
      id: 'context7-docs',
      name: 'Context7 Docs',
      tags: expect.not.arrayContaining(['mutated']),
      authStrategy: { alternatives: ['api-key'] },
    })
  })

  it('returns all presets for an empty search query', () => {
    expect(searchMcpPresets('  ')).toEqual(listMcpPresets())
  })
})
