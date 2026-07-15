import type { ConnectorManifest, MarketplaceItem } from '../schemas.js'

export interface ProviderPage<T extends MarketplaceItem = MarketplaceItem> {
  items: T[]
  nextCursor?: string
  skipped?: Array<{ sourceId: string; reason: string }>
}

export interface MarketplaceProviderAdapter<T extends MarketplaceItem = MarketplaceItem> {
  readonly provider: string
  listPage(options?: { cursor?: string; limit?: number }): Promise<ProviderPage<T>>
}

/**
 * Optional catalog providers implement these interfaces in separate integration
 * packages. The marketplace contract does not depend on either service.
 */
export interface SmitheryCatalogAdapter extends MarketplaceProviderAdapter<ConnectorManifest> {
  readonly provider: 'smithery'
}

export interface GlamaCatalogAdapter extends MarketplaceProviderAdapter<ConnectorManifest> {
  readonly provider: 'glama'
}
