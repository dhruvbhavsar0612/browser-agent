import { z } from 'zod'
import { McpServerConfig } from '../config/schema.js'

export const McpServerId = z
  .string()
  .min(1)
  .max(80)
  .regex(
    /^[a-z0-9][a-z0-9._-]*$/,
    'MCP server id must use lowercase letters, numbers, dots, dashes, or underscores',
  )

export const McpServerCreatePayload = z.object({
  id: McpServerId,
  server: McpServerConfig,
})

export const McpServerUpdatePayload = z.object({
  id: McpServerId,
  patch: McpServerConfig.partial(),
})

export const McpServerIdPayload = z.object({ id: McpServerId })

export const McpCredentialSetPayload = z.object({
  id: McpServerId,
  secret: z.string().min(1),
})

export const McpOAuthCompletePayload = z.object({
  id: McpServerId,
  callbackUrl: z.string().url(),
})

export const McpResourceReadPayload = z.object({
  id: McpServerId,
  uri: z.string().min(1),
})

export const McpMarketplaceSearchPayload = z.object({
  query: z.string().default(''),
  source: z.enum(['official', 'catalog']).default('official'),
  limit: z.number().int().min(1).max(100).default(30),
})

export const McpMarketplaceImportPayload = z.object({
  manifest: z.record(z.string(), z.unknown()),
  id: McpServerId.optional(),
})

export type McpServerCreatePayload = z.infer<typeof McpServerCreatePayload>
export type McpServerUpdatePayload = z.infer<typeof McpServerUpdatePayload>
