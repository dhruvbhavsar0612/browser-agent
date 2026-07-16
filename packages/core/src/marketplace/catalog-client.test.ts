import { describe, expect, it, vi } from 'vitest'
import { HttpMarketplaceCatalogClient } from './catalog-client.js'

describe('HttpMarketplaceCatalogClient', () => {
  it('fetches summaries while retaining the declarative document', async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        schemaVersion: '1.0',
        generatedAt: '2026-07-15T12:00:00.000Z',
        items: [
          {
            schemaVersion: '1.0',
            kind: 'connector',
            id: 'io.example/search',
            version: '1.0.0',
            name: 'Search',
            description: 'Search connector',
            transport: { streamableHttp: { url: 'https://example.com/mcp' } },
          },
        ],
      }),
    )
    const client = new HttpMarketplaceCatalogClient(
      'https://catalog.example.com/catalog.json',
      fetchImpl,
    )

    const catalog = await client.getCatalog()

    expect(catalog.items[0]).toMatchObject({
      kind: 'connector',
      id: 'io.example/search',
      document: {
        transport: { streamableHttp: { url: 'https://example.com/mcp' } },
      },
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://catalog.example.com/catalog.json',
      expect.objectContaining({ headers: { accept: 'application/json' } }),
    )
  })

  it('rejects malformed catalog summaries', async () => {
    const client = new HttpMarketplaceCatalogClient(
      'https://catalog.example.com/catalog.json',
      async () => Response.json({ schemaVersion: '1.0', generatedAt: 'invalid', items: [{}] }),
    )

    await expect(client.getCatalog()).rejects.toThrow('Invalid marketplace item summary')
  })
})
