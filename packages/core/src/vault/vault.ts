import {
  VAULT_LOCAL_KEY,
  VAULT_META_KEY,
  type StorageAdapter,
} from '../config/storage.js'
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

interface StoredBlob {
  type: CredentialType
  ciphertext: string
  iv: string
}

type VaultStore = Record<string, StoredBlob>

export class CredentialVault {
  private keyPromise: Promise<CryptoKey> | undefined

  constructor(private readonly storage: StorageAdapter) {}

  async set(providerId: string, secret: string, type: CredentialType = 'api'): Promise<void> {
    const key = await this.getOrCreateKey()
    const encrypted = await encryptAesGcm(key, secret)
    const store = await this.readStore()
    store[providerId] = {
      type,
      ciphertext: encrypted.ciphertext,
      iv: encrypted.iv,
    }
    await this.writeStore(store)
  }

  async get(providerId: string): Promise<VaultCredential | undefined> {
    const store = await this.readStore()
    const blob = store[providerId]
    if (!blob) return undefined
    const key = await this.getOrCreateKey()
    const secret = await decryptAesGcm(key, { ciphertext: blob.ciphertext, iv: blob.iv })
    return { providerId, secret, type: blob.type }
  }

  /** Returns provider ids and types only — never secrets */
  async list(): Promise<VaultListEntry[]> {
    const store = await this.readStore()
    return Object.entries(store).map(([providerId, blob]) => ({
      providerId,
      type: blob.type,
    }))
  }

  async delete(providerId: string): Promise<void> {
    const store = await this.readStore()
    if (!(providerId in store)) return
    delete store[providerId]
    await this.writeStore(store)
  }

  async clear(): Promise<void> {
    await this.storage.removeLocal(VAULT_LOCAL_KEY)
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
