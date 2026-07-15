import { describe, expect, it, vi } from 'vitest'
import { connectorManifestToConfig, McpMarketplaceService } from './marketplace.js'

describe('MCP marketplace', () => {
  it('uses the Official MCP Registry as the canonical searchable source', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) =>
      Response.json({
        servers: [
          {
            server: {
              name: 'official/docs',
              title: 'Official Docs',
              description: 'Search documentation',
              version: '2.0.0',
              remotes: [
                {
                  type: 'streamable-http',
                  url: 'https://docs.example/mcp',
                  headers: [{ name: 'Authorization', isSecret: true, isRequired: true }],
                },
              ],
            },
          },
        ],
      }),
    )
    const marketplace = new McpMarketplaceService(fetchMock as typeof fetch)
    const connectors = await marketplace.search('docs')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      'registry.modelcontextprotocol.io/v0.1/servers',
    )
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('search=docs')
    expect(connectors[0]).toMatchObject({
      id: 'official/docs',
      url: 'https://docs.example/mcp',
      authMode: 'bearer',
      provenance: { provider: 'official-mcp' },
    })
  })

  it('validates compatible remote connector imports without requiring a marketplace', () => {
    const converted = connectorManifestToConfig({
      kind: 'connector',
      id: 'manual/local',
      version: '1.0.0',
      name: 'Local',
      transport: { streamableHttp: { url: 'http://localhost:8787/mcp' } },
      auth: { type: 'none' },
      registry: { provider: 'manual' },
    })
    expect(converted).toEqual({
      id: 'manual-local',
      config: expect.objectContaining({
        url: 'http://localhost:8787/mcp',
        provenance: expect.objectContaining({ provider: 'manual' }),
      }),
    })
    expect(() =>
      connectorManifestToConfig({
        kind: 'connector',
        id: 'bad/http',
        name: 'Bad',
        transport: { streamableHttp: { url: 'http://example.com/mcp' } },
        auth: { type: 'none' },
      }),
    ).toThrow(/HTTPS/)
  })
})
