import { describe, expect, it } from 'vitest'
import { normalizeMcpToolResult } from './result.js'

describe('normalizeMcpToolResult', () => {
  it('preserves errors, URLs, structured summaries, and MCP metadata', () => {
    const result = normalizeMcpToolResult(
      {
        isError: true,
        content: [{ type: 'text', text: 'Request failed at https://example.com/jobs/42' }],
        structuredContent: { status: 503, reason: 'upstream unavailable' },
      },
      { serverId: 'jobs', serverName: 'Jobs', toolName: 'status' },
    )

    expect(result._mcp).toEqual({
      serverId: 'jobs',
      serverName: 'Jobs',
      toolName: 'status',
      isError: true,
    })
    expect(result.error).toContain('Request failed')
    expect(result.urls).toEqual(['https://example.com/jobs/42'])
    expect(result.structuredContent).toEqual({ status: 503, reason: 'upstream unavailable' })
  })

  it('bounds oversized content before streaming or persistence', () => {
    const result = normalizeMcpToolResult(
      { content: [{ type: 'text', text: 'x'.repeat(40_000) }] },
      { serverId: 'large', serverName: 'Large', toolName: 'read' },
      2_000,
    )
    expect(result.truncated).toBe(true)
    expect(result.originalChars).toBeGreaterThan(30_000)
    expect(JSON.stringify(result).length).toBeLessThan(5_000)
  })
})
