import { describe, expect, it, vi } from 'vitest'
import {
  OfficialMcpRegistryAdapter,
  normalizeRegistryEntry,
  type FetchLike,
} from './mcp-registry.js'

const registryEntry = {
  server: {
    name: 'io.example/search',
    title: 'Example Search',
    description: 'Search through a hosted remote MCP service.',
    version: '2026.7',
    websiteUrl: 'https://example.com/search',
    remotes: [
      {
        type: 'streamable-http',
        url: 'https://mcp.example.com/search',
        headers: [
          {
            name: 'Authorization',
            description: 'Bearer credential',
            isRequired: true,
            isSecret: true,
            value: 'ignored-upstream-value',
          },
        ],
      },
      {
        type: 'sse',
        url: 'https://mcp.example.com/search/sse',
      },
    ],
  },
  _meta: {
    'io.modelcontextprotocol.registry/official': {
      status: 'active',
      isLatest: true,
    },
  },
}

describe('official MCP Registry adapter', () => {
  it('normalizes remote Registry entries without copying credential values', () => {
    const normalized = normalizeRegistryEntry(registryEntry, {
      importedAt: new Date('2026-07-15T12:00:00.000Z'),
    })

    expect(normalized).toMatchObject({
      kind: 'connector',
      id: 'io.example/search',
      version: '2026.7',
      transport: {
        streamableHttp: {
          url: 'https://mcp.example.com/search',
          headers: [
            {
              name: 'Authorization',
              required: true,
              secret: true,
            },
          ],
        },
        legacySse: { url: 'https://mcp.example.com/search/sse' },
      },
      auth: {
        type: 'bearer',
        credentialKeys: ['Authorization'],
      },
      registry: {
        provider: 'official-mcp',
        sourceId: 'io.example/search@2026.7',
      },
      verification: {
        status: 'registry',
        checksum: { algorithm: 'sha256' },
      },
    })
    expect(JSON.stringify(normalized)).not.toContain('ignored-upstream-value')
    expect(normalized?.verification.checksum.digest).toMatch(/^[a-f0-9]{64}$/)
  })

  it('paginates through the canonical API with injected fetch', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        servers: [
          registryEntry,
          {
            server: {
              name: 'io.example/sse-only',
              description: 'Legacy endpoint only.',
              version: '1.0.0',
              remotes: [{ type: 'sse', url: 'https://mcp.example.com/legacy/sse' }],
            },
          },
        ],
        metadata: { nextCursor: 'next-page' },
      }),
    )
    const fetchImpl = fetchMock as unknown as FetchLike
    const adapter = new OfficialMcpRegistryAdapter(
      fetchImpl,
      'https://registry.modelcontextprotocol.io',
      () => new Date('2026-07-15T12:00:00.000Z'),
    )

    const page = await adapter.listPage({ cursor: 'cursor value', limit: 25 })

    expect(page.items).toHaveLength(1)
    expect(page.nextCursor).toBe('next-page')
    expect(page.skipped).toEqual([
      {
        sourceId: 'io.example/sse-only@1.0.0',
        reason: 'No concrete HTTPS Streamable HTTP remote endpoint',
      },
    ])
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]))
    expect(requested.pathname).toBe('/v0.1/servers')
    expect(requested.searchParams.get('version')).toBe('latest')
    expect(requested.searchParams.get('cursor')).toBe('cursor value')
    expect(requested.searchParams.get('limit')).toBe('25')
  })

  it('skips templated or insecure endpoints until config resolution is defined', () => {
    expect(
      normalizeRegistryEntry({
        server: {
          name: 'io.example/template',
          description: 'Needs unresolved configuration.',
          version: '1.0.0',
          remotes: [{ type: 'streamable-http', url: '{baseUrl}/mcp' }],
        },
      }),
    ).toBeNull()
    expect(
      normalizeRegistryEntry({
        server: {
          name: 'io.example/insecure',
          description: 'Uses cleartext transport.',
          version: '1.0.0',
          remotes: [{ type: 'streamable-http', url: 'http://example.com/mcp' }],
        },
      }),
    ).toBeNull()
  })
})
