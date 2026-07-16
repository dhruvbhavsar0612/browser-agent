import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  ConnectorManifestSchema,
  MARKETPLACE_SCHEMA_VERSION,
  type ConnectorManifest,
} from '../schemas.js'
import type { MarketplaceProviderAdapter, ProviderPage } from './types.js'

export const OFFICIAL_MCP_REGISTRY_URL = 'https://registry.modelcontextprotocol.io'

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const RegistryInputSchema = z
  .object({
    description: z.string().optional(),
    isRequired: z.boolean().optional(),
    isSecret: z.boolean().optional(),
    name: z.string(),
  })
  .passthrough()

const RegistryRemoteSchema = z
  .object({
    type: z.enum(['streamable-http', 'sse']),
    url: z.string(),
    headers: z.array(RegistryInputSchema).optional(),
  })
  .passthrough()

const RegistryServerSchema = z
  .object({
    name: z.string(),
    title: z.string().optional(),
    description: z.string(),
    version: z.string(),
    websiteUrl: z.string().optional(),
    repository: z
      .object({
        url: z.string().optional(),
      })
      .passthrough()
      .optional(),
    remotes: z.array(RegistryRemoteSchema).optional(),
  })
  .passthrough()

const RegistryEntrySchema = z
  .object({
    server: RegistryServerSchema,
    _meta: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough()

const RegistryResponseSchema = z
  .object({
    servers: z.array(RegistryEntrySchema),
    metadata: z
      .object({
        nextCursor: z.string().optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${stableJson(nested)}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

function registryChecksum(server: RegistryEntry['server']): string {
  return createHash('sha256').update(stableJson(server)).digest('hex')
}

function toHeaderMetadata(
  headers: Array<z.infer<typeof RegistryInputSchema>> | undefined,
): Array<{ name: string; description?: string; required: boolean; secret: boolean }> | undefined {
  if (!headers?.length) return undefined
  return headers.map((header) => ({
    name: header.name,
    ...(header.description ? { description: header.description } : {}),
    required: header.isRequired ?? false,
    secret: header.isSecret ?? false,
  }))
}

function inferAuth(
  headers: Array<z.infer<typeof RegistryInputSchema>> | undefined,
): ConnectorManifest['auth'] {
  if (!headers?.length) return { type: 'none' }
  const credentialKeys = headers.filter((header) => header.isSecret).map((header) => header.name)
  const hasBearer = headers.some((header) => header.name.toLowerCase() === 'authorization')
  return {
    type: hasBearer ? 'bearer' : 'api-key',
    ...(credentialKeys.length ? { credentialKeys } : {}),
  }
}

function isConcreteHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeRegistryEntry(
  input: unknown,
  options: { importedAt?: Date; registryUrl?: string } = {},
): ConnectorManifest | null {
  const entry = RegistryEntrySchema.parse(input)
  const streamable = entry.server.remotes?.find(
    (remote) => remote.type === 'streamable-http' && isConcreteHttpsUrl(remote.url),
  )
  if (!streamable) return null
  const legacySse = entry.server.remotes?.find(
    (remote) => remote.type === 'sse' && isConcreteHttpsUrl(remote.url),
  )
  const registryUrl = options.registryUrl ?? OFFICIAL_MCP_REGISTRY_URL
  const serverPath = encodeURIComponent(entry.server.name)
  const versionPath = encodeURIComponent(entry.server.version)
  const homepage = entry.server.websiteUrl ?? entry.server.repository?.url

  return ConnectorManifestSchema.parse({
    schemaVersion: MARKETPLACE_SCHEMA_VERSION,
    kind: 'connector',
    id: entry.server.name.toLowerCase(),
    version: entry.server.version,
    name: entry.server.title ?? entry.server.name.split('/').at(-1) ?? entry.server.name,
    description: entry.server.description,
    transport: {
      streamableHttp: {
        url: streamable.url,
        ...(toHeaderMetadata(streamable.headers)
          ? { headers: toHeaderMetadata(streamable.headers) }
          : {}),
      },
      ...(legacySse
        ? {
            legacySse: {
              url: legacySse.url,
              ...(toHeaderMetadata(legacySse.headers)
                ? { headers: toHeaderMetadata(legacySse.headers) }
                : {}),
            },
          }
        : {}),
    },
    auth: inferAuth(streamable.headers),
    registry: {
      provider: 'official-mcp',
      sourceUrl: `${registryUrl}/v0.1/servers/${serverPath}/versions/${versionPath}`,
      sourceId: `${entry.server.name}@${entry.server.version}`,
      importedAt: (options.importedAt ?? new Date()).toISOString(),
    },
    capabilities: {
      tools: [],
      resources: false,
      prompts: false,
    },
    toolAnnotations: [],
    compatibility: {
      browserAgent: '*',
      mcpProtocol: '>=2025-03-26',
    },
    license: {
      spdx: 'NOASSERTION',
      ...(homepage && isConcreteHttpsUrl(homepage) ? { url: homepage } : {}),
    },
    maintainer: {
      name: entry.server.name.split('/')[0] ?? entry.server.name,
      ...(homepage && isConcreteHttpsUrl(homepage) ? { url: homepage } : {}),
    },
    verification: {
      status: 'registry',
      checkedAt: (options.importedAt ?? new Date()).toISOString(),
      checksum: {
        algorithm: 'sha256',
        digest: registryChecksum(entry.server),
      },
    },
  })
}

export class OfficialMcpRegistryAdapter implements MarketplaceProviderAdapter<ConnectorManifest> {
  readonly provider = 'official-mcp'

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly baseUrl = OFFICIAL_MCP_REGISTRY_URL,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async listPage(
    options: { cursor?: string; limit?: number } = {},
  ): Promise<ProviderPage<ConnectorManifest>> {
    const url = new URL('/v0.1/servers', this.baseUrl)
    url.searchParams.set('version', 'latest')
    url.searchParams.set('limit', String(options.limit ?? 100))
    if (options.cursor) url.searchParams.set('cursor', options.cursor)

    const response = await this.fetchImpl(url, {
      headers: { accept: 'application/json' },
    })
    if (!response.ok) {
      throw new Error(`Official MCP Registry HTTP ${response.status}`)
    }

    const page = RegistryResponseSchema.parse(await response.json())
    const items: ConnectorManifest[] = []
    const skipped: Array<{ sourceId: string; reason: string }> = []
    const importedAt = this.now()

    for (const entry of page.servers) {
      const normalized = normalizeRegistryEntry(entry, {
        importedAt,
        registryUrl: this.baseUrl,
      })
      if (normalized) {
        items.push(normalized)
      } else {
        skipped.push({
          sourceId: `${entry.server.name}@${entry.server.version}`,
          reason: 'No concrete HTTPS Streamable HTTP remote endpoint',
        })
      }
    }

    return {
      items,
      ...(page.metadata?.nextCursor ? { nextCursor: page.metadata.nextCursor } : {}),
      ...(skipped.length ? { skipped } : {}),
    }
  }
}
