export type MarketplaceItemKind = 'connector' | 'skill' | 'plugin'

export interface MarketplaceCatalogItem {
  schemaVersion: string
  kind: MarketplaceItemKind
  id: string
  version: string
  name: string
  description: string
  /** Full declarative manifest; installation validates it with the contract package. */
  document: Readonly<Record<string, unknown>>
}

export interface MarketplaceCatalog {
  schemaVersion: string
  generatedAt: string
  items: MarketplaceCatalogItem[]
}

export interface MarketplaceCatalogClient {
  getCatalog(options?: { signal?: AbortSignal }): Promise<MarketplaceCatalog>
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

function parseCatalog(input: unknown): MarketplaceCatalog {
  if (typeof input !== 'object' || input === null) throw new Error('Invalid marketplace catalog')
  const candidate = input as Record<string, unknown>
  if (
    typeof candidate.schemaVersion !== 'string' ||
    typeof candidate.generatedAt !== 'string' ||
    !Array.isArray(candidate.items)
  ) {
    throw new Error('Invalid marketplace catalog envelope')
  }

  const items = candidate.items.map((item): MarketplaceCatalogItem => {
    if (typeof item !== 'object' || item === null) throw new Error('Invalid marketplace item')
    const document = item as Record<string, unknown>
    const { schemaVersion, kind, id, version, name, description } = document
    if (
      typeof schemaVersion !== 'string' ||
      !['connector', 'skill', 'plugin'].includes(String(kind)) ||
      typeof id !== 'string' ||
      typeof version !== 'string' ||
      typeof name !== 'string' ||
      typeof description !== 'string'
    ) {
      throw new Error('Invalid marketplace item summary')
    }
    return {
      schemaVersion,
      kind: kind as MarketplaceItemKind,
      id,
      version,
      name,
      description,
      document,
    }
  })

  return {
    schemaVersion: candidate.schemaVersion,
    generatedAt: candidate.generatedAt,
    items,
  }
}

/**
 * Read-only discovery boundary. It deliberately does not install connectors,
 * resolve credentials, or create an MCP transport.
 */
export class HttpMarketplaceCatalogClient implements MarketplaceCatalogClient {
  constructor(
    private readonly catalogUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  async getCatalog(options: { signal?: AbortSignal } = {}): Promise<MarketplaceCatalog> {
    const response = await this.fetchImpl(this.catalogUrl, {
      headers: { accept: 'application/json' },
      signal: options.signal,
    })
    if (!response.ok) throw new Error(`Marketplace catalog HTTP ${response.status}`)
    return parseCatalog(await response.json())
  }
}
