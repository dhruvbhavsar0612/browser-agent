import { z } from 'zod'

export const MARKETPLACE_SCHEMA_VERSION = '1.0' as const

const exactVersion = /^[0-9A-Za-z][0-9A-Za-z._+-]*$/
const itemId = /^[a-z0-9][a-z0-9.-]*\/[a-z0-9][a-z0-9._-]*$/
const sha256 = /^[a-f0-9]{64}$/
const relativeMarkdown = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$)).+\.md$/i

const Version = z.string().max(255).regex(exactVersion, 'must be an exact version, not a range')
const ItemId = z.string().min(3).max(200).regex(itemId, 'must use namespace/name format')
const HttpsUrl = z
  .url()
  .refine((value) => value.startsWith('https://'), 'remote endpoints must use HTTPS')

export const ChecksumSchema = z
  .object({
    algorithm: z.literal('sha256'),
    digest: z.string().regex(sha256, 'must be a lowercase SHA-256 digest'),
  })
  .strict()

export const LicenseSchema = z
  .object({
    spdx: z.string().min(1),
    url: HttpsUrl.optional(),
  })
  .strict()

export const MaintainerSchema = z
  .object({
    name: z.string().min(1),
    url: HttpsUrl.optional(),
    email: z.email().optional(),
  })
  .strict()

export const ProvenanceSchema = z
  .object({
    provider: z.enum(['official-mcp', 'smithery', 'glama', 'manual']),
    sourceUrl: HttpsUrl,
    sourceId: z.string().min(1),
    importedAt: z.iso.datetime().optional(),
  })
  .strict()

export const CompatibilitySchema = z
  .object({
    browserAgent: z.string().min(1),
    mcpProtocol: z.string().min(1),
    remoteMcpConfigSchema: z.string().min(1).optional(),
  })
  .strict()

export const ItemReferenceSchema = z
  .object({
    id: ItemId,
    version: Version,
  })
  .strict()

const HeaderMetadataSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1).optional(),
    required: z.boolean(),
    secret: z.boolean(),
  })
  .strict()

const EndpointSchema = z
  .object({
    url: HttpsUrl,
    headers: z.array(HeaderMetadataSchema).optional(),
  })
  .strict()

const AuthMetadataSchema = z
  .object({
    type: z.enum(['none', 'oauth2', 'api-key', 'bearer']),
    authorizationUrl: HttpsUrl.optional(),
    tokenUrl: HttpsUrl.optional(),
    scopes: z.array(z.string().min(1)).optional(),
    credentialKeys: z.array(z.string().min(1)).optional(),
    instructionsUrl: HttpsUrl.optional(),
  })
  .strict()
  .superRefine((auth, ctx) => {
    if (auth.type === 'oauth2' && !auth.authorizationUrl) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorizationUrl'],
        message: 'OAuth metadata requires authorizationUrl',
      })
    }
  })

const ToolAnnotationSchema = z
  .object({
    name: z.string().min(1),
    title: z.string().min(1).optional(),
    readOnlyHint: z.boolean().optional(),
    destructiveHint: z.boolean().optional(),
    idempotentHint: z.boolean().optional(),
    openWorldHint: z.boolean().optional(),
  })
  .strict()

const CapabilitiesSchema = z
  .object({
    tools: z.array(z.string().min(1)),
    resources: z.boolean(),
    prompts: z.boolean(),
  })
  .strict()

const VerificationSchema = z
  .object({
    status: z.enum(['unverified', 'registry', 'verified']),
    checkedAt: z.iso.datetime().optional(),
    checksum: ChecksumSchema,
    signature: z
      .object({
        scheme: z.enum(['sigstore', 'minisign']),
        bundleUrl: HttpsUrl,
        identity: z.string().min(1),
      })
      .strict()
      .optional(),
  })
  .strict()

export const ConnectorManifestSchema = z
  .object({
    schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
    kind: z.literal('connector'),
    id: ItemId,
    version: Version,
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    transport: z
      .object({
        streamableHttp: EndpointSchema,
        legacySse: EndpointSchema.optional(),
      })
      .strict(),
    auth: AuthMetadataSchema,
    registry: ProvenanceSchema,
    capabilities: CapabilitiesSchema,
    toolAnnotations: z.array(ToolAnnotationSchema),
    compatibility: CompatibilitySchema,
    license: LicenseSchema,
    maintainer: MaintainerSchema,
    verification: VerificationSchema,
  })
  .strict()

const RequiredToolSchema = z
  .object({
    connectorId: ItemId,
    name: z.string().min(1),
  })
  .strict()

export const SkillManifestSchema = z
  .object({
    schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
    kind: z.literal('skill'),
    id: ItemId,
    version: Version,
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    instructions: z
      .object({
        path: z.string().regex(relativeMarkdown, 'must be a safe relative Markdown path'),
      })
      .strict(),
    requiredConnectors: z.array(ItemReferenceSchema),
    requiredTools: z.array(RequiredToolSchema),
    compatibility: CompatibilitySchema,
    license: LicenseSchema,
    provenance: ProvenanceSchema,
    checksum: ChecksumSchema,
  })
  .strict()

const DeclarativeValueSchema = z.union([z.string(), z.number(), z.boolean()])
const DeclarativeSettingSchema = z.union([
  z.object({ value: DeclarativeValueSchema }).strict(),
  z.object({ secret: z.string().min(1) }).strict(),
])

export const PluginManifestSchema = z
  .object({
    schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
    kind: z.literal('plugin'),
    id: ItemId,
    version: Version,
    name: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
    connector: ItemReferenceSchema.extend({
      config: z
        .object({
          enabled: z.boolean().optional(),
          variables: z.record(z.string(), DeclarativeSettingSchema).optional(),
        })
        .strict()
        .optional(),
    }).strict(),
    skills: z
      .array(
        ItemReferenceSchema.extend({
          config: z.object({ enabled: z.boolean().optional() }).strict().optional(),
        }).strict(),
      )
      .min(1),
    compatibility: CompatibilitySchema,
    license: LicenseSchema,
    provenance: ProvenanceSchema,
    checksum: ChecksumSchema,
  })
  .strict()

export const MarketplaceItemSchema = z.discriminatedUnion('kind', [
  ConnectorManifestSchema,
  SkillManifestSchema,
  PluginManifestSchema,
])

export const CatalogSchema = z
  .object({
    schemaVersion: z.literal(MARKETPLACE_SCHEMA_VERSION),
    generatedAt: z.iso.datetime(),
    items: z.array(MarketplaceItemSchema),
  })
  .strict()

export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>
export type SkillManifest = z.infer<typeof SkillManifestSchema>
export type PluginManifest = z.infer<typeof PluginManifestSchema>
export type MarketplaceItem = z.infer<typeof MarketplaceItemSchema>
export type MarketplaceCatalog = z.infer<typeof CatalogSchema>
export type ItemReference = z.infer<typeof ItemReferenceSchema>
