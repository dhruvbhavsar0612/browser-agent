import { VAULT_LOCAL_KEY, VAULT_META_KEY, type StorageAdapter } from '../config/storage.js'
import {
  decryptAesGcm,
  encryptAesGcm,
  exportKeyRaw,
  generateVaultKey,
  importKeyRaw,
} from './crypto.js'

export type CredentialType = 'api' | 'oauth'

export interface VaultCredential {
  providerId: string
  secret: string
  type: CredentialType
}

/** Public list entry — never includes secrets */
export interface VaultListEntry {
  providerId: string
  type: CredentialType
}

export interface McpVaultListEntry {
  serverId: string
  type: CredentialType
}

const MCP_CREDENTIAL_PREFIX = 'mcp/'

function mcpCredentialKey(serverId: string): string {
  return `${MCP_CREDENTIAL_PREFIX}${encodeURIComponent(serverId)}`
}

interface EncryptedSecret {
  ciphertext: string
  iv: string
}

/** Per-provider record — API key and OAuth may both be stored */
interface VaultProviderRecord {
  api?: EncryptedSecret
  oauth?: EncryptedSecret
}

/** Legacy v1 blob (single credential per provider) */
interface LegacyStoredBlob {
  type: CredentialType
  ciphertext: string
  iv: string
}

type VaultStore = Record<string, VaultProviderRecord | LegacyStoredBlob>

function isLegacyBlob(value: unknown): value is LegacyStoredBlob {
  return (
    !!value &&
    typeof value === 'object' &&
    'ciphertext' in value &&
    'iv' in value &&
    !('api' in value) &&
    !('oauth' in value)
  )
}

function normalizeRecord(raw: unknown): VaultProviderRecord {
  if (!raw || typeof raw !== 'object') return {}
  if (isLegacyBlob(raw)) {
    const type = raw.type === 'oauth' ? 'oauth' : 'api'
    return { [type]: { ciphertext: raw.ciphertext, iv: raw.iv } }
  }
  const record = raw as VaultProviderRecord
  return {
    api: record.api,
    oauth: record.oauth,
  }
}

export class CredentialVault {
  private keyPromise: Promise<CryptoKey> | undefined

  constructor(private readonly storage: StorageAdapter) {}

  async set(providerId: string, secret: string, type: CredentialType = 'api'): Promise<void> {
    await this.setByKey(providerId, secret, type)
  }

  /** Dedicated encrypted namespace for remote MCP bearer/API/OAuth credentials. */
  async setMcp(serverId: string, secret: string, type: CredentialType = 'api'): Promise<void> {
    await this.setByKey(mcpCredentialKey(serverId), secret, type)
  }

  private async setByKey(keyId: string, secret: string, type: CredentialType): Promise<void> {
    const key = await this.getOrCreateKey()
    const encrypted = await encryptAesGcm(key, secret)
    const store = await this.readStore()
    const record = normalizeRecord(store[keyId])
    record[type] = { ciphertext: encrypted.ciphertext, iv: encrypted.iv }
    store[keyId] = record
    await this.writeStore(store)
  }

  /**
   * Returns the preferred credential for a provider: OAuth when present, else API key.
   * Pass `type` to fetch a specific credential.
   */
  async get(providerId: string, type?: CredentialType): Promise<VaultCredential | undefined> {
    return this.getByKey(providerId, providerId, type)
  }

  async getMcp(serverId: string, type?: CredentialType): Promise<VaultCredential | undefined> {
    return this.getByKey(mcpCredentialKey(serverId), serverId, type)
  }

  private async getByKey(
    keyId: string,
    publicId: string,
    type?: CredentialType,
  ): Promise<VaultCredential | undefined> {
    const store = await this.readStore()
    const record = normalizeRecord(store[keyId])
    if (!record.api && !record.oauth) return undefined

    const resolvedType: CredentialType = type ?? (record.oauth ? 'oauth' : 'api')
    const blob = record[resolvedType]
    if (!blob) return undefined

    const key = await this.getOrCreateKey()
    const secret = await decryptAesGcm(key, blob)
    return { providerId: publicId, secret, type: resolvedType }
  }

  /** Returns provider ids and types only — never secrets. May include two entries per provider. */
  async list(): Promise<VaultListEntry[]> {
    const store = await this.readStore()
    const entries: VaultListEntry[] = []
    for (const [providerId, raw] of Object.entries(store)) {
      if (providerId.startsWith(MCP_CREDENTIAL_PREFIX)) continue
      const record = normalizeRecord(raw)
      if (record.api) entries.push({ providerId, type: 'api' })
      if (record.oauth) entries.push({ providerId, type: 'oauth' })
    }
    return entries
  }

  async listMcp(): Promise<McpVaultListEntry[]> {
    const store = await this.readStore()
    const entries: McpVaultListEntry[] = []
    for (const [key, raw] of Object.entries(store)) {
      if (!key.startsWith(MCP_CREDENTIAL_PREFIX)) continue
      const serverId = decodeURIComponent(key.slice(MCP_CREDENTIAL_PREFIX.length))
      const record = normalizeRecord(raw)
      if (record.api) entries.push({ serverId, type: 'api' })
      if (record.oauth) entries.push({ serverId, type: 'oauth' })
    }
    return entries
  }

  /**
   * Deletes credentials for a provider.
   * When `type` is omitted, removes both API and OAuth entries.
   */
  async delete(providerId: string, type?: CredentialType): Promise<void> {
    await this.deleteByKey(providerId, type)
  }

  async deleteMcp(serverId: string, type?: CredentialType): Promise<void> {
    await this.deleteByKey(mcpCredentialKey(serverId), type)
  }

  private async deleteByKey(keyId: string, type?: CredentialType): Promise<void> {
    const store = await this.readStore()
    if (!(keyId in store)) return

    if (!type) {
      delete store[keyId]
      await this.writeStore(store)
      return
    }

    const record = normalizeRecord(store[keyId])
    delete record[type]
    if (!record.api && !record.oauth) {
      delete store[keyId]
    } else {
      store[keyId] = record
    }
    await this.writeStore(store)
  }

  async clear(): Promise<void> {
    await this.storage.removeLocal(VAULT_LOCAL_KEY)
    await this.storage.removeLocal(VAULT_META_KEY)
    this.keyPromise = undefined
  }

  private async getOrCreateKey(): Promise<CryptoKey> {
    if (!this.keyPromise) {
      this.keyPromise = this.loadOrCreateKey()
    }
    return this.keyPromise
  }

  private async loadOrCreateKey(): Promise<CryptoKey> {
    const existing = await this.storage.getLocal<string>(VAULT_META_KEY)
    if (existing) {
      return importKeyRaw(existing)
    }
    const key = await generateVaultKey()
    const exported = await exportKeyRaw(key)
    await this.storage.setLocal(VAULT_META_KEY, exported)
    return key
  }

  private async readStore(): Promise<VaultStore> {
    const store = await this.storage.getLocal<VaultStore>(VAULT_LOCAL_KEY)
    return store && typeof store === 'object' ? { ...store } : {}
  }

  private async writeStore(store: VaultStore): Promise<void> {
    await this.storage.setLocal(VAULT_LOCAL_KEY, store)
  }
}
