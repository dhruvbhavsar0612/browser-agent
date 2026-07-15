import type { MarketplaceCatalogClient } from '../marketplace/index.js'
import { isSecureRemoteUrl, type McpServerConfigPatch } from '../config/schema.js'
import type { McpMarketplaceConnector } from './types.js'

type FetchLike = typeof fetch

const OFFICIAL_MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid remote connector manifest')
  }
  return value as Record<string, unknown>
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Connector ${field} is required`)
  return value
}

function inferAuth(headers: unknown): McpMarketplaceConnector['authMode'] {
  if (!Array.isArray(headers)) return 'none'
  const names = headers
    .map((header) =>
      header && typeof header === 'object' ? String((header as { name?: unknown }).name ?? '') : '',
    )
    .map((name) => name.toLowerCase())
  if (names.includes('authorization')) return 'bearer'
  return names.length ? 'api-key' : 'none'
}

export function connectorManifestToConfig(input: unknown): {
  id: string
  config: McpServerConfigPatch
} {
  const manifest = object(input)
  if (manifest.kind !== 'connector') throw new Error('Marketplace item is not an MCP connector')
  const transport = object(manifest.transport)
  const streamable = object(transport.streamableHttp)
  const url = string(streamable.url, 'transport.streamableHttp.url')
  if (!isSecureRemoteUrl(url)) {
    throw new Error('Connector URL must use HTTPS (HTTP is allowed for localhost only)')
  }
  const auth = object(manifest.auth)
  const authType = typeof auth.type === 'string' ? auth.type : 'none'
  const mode =
    authType === 'oauth2'
      ? 'oauth'
      : authType === 'bearer'
        ? 'bearer'
        : authType === 'api-key'
          ? 'api-key'
          : 'none'
  const rawId = string(manifest.id, 'id')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
  const id = rawId.replace(/^-+|-+$/g, '') || `mcp-${Date.now()}`
  const registry =
    manifest.registry && typeof manifest.registry === 'object'
      ? (manifest.registry as Record<string, unknown>)
      : undefined
  const provider =
    registry?.provider === 'official-mcp' ||
    registry?.provider === 'smithery' ||
    registry?.provider === 'glama'
      ? registry.provider
      : 'manual'

  return {
    id,
    config: {
      type: 'remote',
      name: string(manifest.name, 'name'),
      url,
      transport: 'streamable-http',
      enabled: true,
      auth: { mode },
      tools: {},
      provenance: {
        provider,
        ...(typeof registry?.sourceUrl === 'string' ? { sourceUrl: registry.sourceUrl } : {}),
        ...(typeof registry?.sourceId === 'string' ? { sourceId: registry.sourceId } : {}),
        ...(typeof manifest.version === 'string' ? { version: manifest.version } : {}),
      },
    },
  }
}

export class McpMarketplaceService {
  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly catalog?: MarketplaceCatalogClient,
    private readonly registryUrl = OFFICIAL_MCP_REGISTRY_URL,
  ) {}

  async search(
    query: string,
    options: { source?: 'official' | 'catalog'; limit?: number; signal?: AbortSignal } = {},
  ): Promise<McpMarketplaceConnector[]> {
    if (options.source === 'catalog') return this.searchCatalog(query, options)
    return this.searchOfficial(query, options)
  }

  private async searchOfficial(
    query: string,
    options: { limit?: number; signal?: AbortSignal },
  ): Promise<McpMarketplaceConnector[]> {
    const url = new URL('/v0.1/servers', this.registryUrl)
    url.searchParams.set('version', 'latest')
    url.searchParams.set('limit', String(Math.min(100, Math.max(1, options.limit ?? 30))))
    if (query.trim()) url.searchParams.set('search', query.trim())
    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
      signal: options.signal,
    })
    if (!response.ok) throw new Error(`Official MCP Registry HTTP ${response.status}`)
    const payload = object(await response.json())
    if (!Array.isArray(payload.servers))
      throw new Error('Official MCP Registry returned invalid data')
    const results: McpMarketplaceConnector[] = []
    for (const entryValue of payload.servers) {
      const entry = object(entryValue)
      const server = object(entry.server)
      const remotes = Array.isArray(server.remotes) ? server.remotes : []
      const remote = remotes
        .map((value) => object(value))
        .find(
          (value) =>
            (value.type === 'streamable-http' || value.type === 'sse') &&
            typeof value.url === 'string' &&
            isSecureRemoteUrl(value.url),
        )
      if (!remote) continue
      const name = typeof server.title === 'string' ? server.title : string(server.name, 'name')
      const id = string(server.name, 'name')
      const version = string(server.version, 'version')
      const sourceUrl = `${this.registryUrl}/v0.1/servers/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}`
      const manifest = {
        schemaVersion: '1.0',
        kind: 'connector',
        id,
        version,
        name,
        description: typeof server.description === 'string' ? server.description : '',
        transport: {
          streamableHttp: {
            url: remote.url,
            ...(Array.isArray(remote.headers) ? { headers: remote.headers } : {}),
          },
        },
        auth: { type: inferAuth(remote.headers) },
        registry: {
          provider: 'official-mcp',
          sourceUrl,
          sourceId: `${id}@${version}`,
        },
      }
      results.push({
        id,
        name,
        description: String(server.description ?? ''),
        version,
        url: String(remote.url),
        transport: remote.type as 'streamable-http' | 'sse',
        authMode: inferAuth(remote.headers),
        provenance: {
          provider: 'official-mcp',
          sourceUrl,
          sourceId: `${id}@${version}`,
        },
        manifest,
      })
    }
    return results
  }

  private async searchCatalog(
    query: string,
    options: { signal?: AbortSignal; limit?: number },
  ): Promise<McpMarketplaceConnector[]> {
    if (!this.catalog) throw new Error('No optional marketplace catalog endpoint is configured')
    const catalog = await this.catalog.getCatalog({ signal: options.signal })
    const normalizedQuery = query.trim().toLowerCase()
    return catalog.items
      .filter(
        (item) =>
          item.kind === 'connector' &&
          (!normalizedQuery ||
            item.name.toLowerCase().includes(normalizedQuery) ||
            item.description.toLowerCase().includes(normalizedQuery) ||
            item.id.toLowerCase().includes(normalizedQuery)),
      )
      .slice(0, options.limit ?? 30)
      .map((item) => {
        const converted = connectorManifestToConfig(item.document)
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          version: item.version,
          url: converted.config.url!,
          transport: 'streamable-http',
          authMode: converted.config.auth?.mode ?? 'none',
          provenance: {
            provider: converted.config.provenance?.provider ?? 'manual',
            sourceUrl: converted.config.provenance?.sourceUrl,
            sourceId: converted.config.provenance?.sourceId,
          },
          manifest: item.document as Record<string, unknown>,
        }
      })
  }
}

export { OFFICIAL_MCP_REGISTRY_URL }
