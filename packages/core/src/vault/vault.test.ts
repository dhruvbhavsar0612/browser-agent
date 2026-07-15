import { describe, expect, it } from 'vitest'
import {
  createMemoryStorage,
  VAULT_LOCAL_KEY,
  VAULT_META_KEY,
} from '../config/storage.js'
import {
  decryptAesGcm,
  encryptAesGcm,
  exportKeyRaw,
  generateVaultKey,
  importKeyRaw,
} from './crypto.js'
import { CredentialVault } from './vault.js'

describe('AES-GCM crypto', () => {
  it('round-trips plaintext', async () => {
    const key = await generateVaultKey()
    const encrypted = await encryptAesGcm(key, 'sk-test-secret')
    expect(encrypted.ciphertext).not.toContain('sk-test-secret')
    expect(encrypted.iv.length).toBeGreaterThan(0)
    const plain = await decryptAesGcm(key, encrypted)
    expect(plain).toBe('sk-test-secret')
  })
})

describe('CredentialVault', () => {
  it('encrypts on set and decrypts on get', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)

    await vault.set('openai', 'sk-live-abc', 'api')
    const got = await vault.get('openai')
    expect(got).toEqual({ providerId: 'openai', secret: 'sk-live-abc', type: 'api' })

    const raw = await storage.getLocal<Record<string, { ciphertext: string; iv: string }>>(
      VAULT_LOCAL_KEY,
    )
    expect(raw?.openai).toBeDefined()
    expect(JSON.stringify(raw)).not.toContain('sk-live-abc')

    const meta = await storage.getLocal<string>(VAULT_META_KEY)
    expect(meta).toBeTruthy()
    expect(await storage.getSync(VAULT_LOCAL_KEY)).toBeUndefined()
    expect(await storage.getSync(VAULT_META_KEY)).toBeUndefined()
  })

  it('list returns ids without leaking secrets', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-secret-1')
    await vault.set('anthropic', 'sk-secret-2', 'api')
    await vault.set('google', 'oauth-token', 'oauth')

    const listed = await vault.list()
    expect(listed).toEqual(
      expect.arrayContaining([
        { providerId: 'openai', type: 'api' },
        { providerId: 'anthropic', type: 'api' },
        { providerId: 'google', type: 'oauth' },
      ]),
    )
    expect(listed).toHaveLength(3)
    expect(JSON.stringify(listed)).not.toContain('sk-secret')
    expect(JSON.stringify(listed)).not.toContain('oauth-token')
  })

  it('stores API key and OAuth side-by-side and prefers OAuth on get()', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-api-key', 'api')
    await vault.set('openai', '{"accessToken":"oauth-tok"}', 'oauth')

    expect(await vault.get('openai')).toEqual({
      providerId: 'openai',
      secret: '{"accessToken":"oauth-tok"}',
      type: 'oauth',
    })
    expect(await vault.get('openai', 'api')).toEqual({
      providerId: 'openai',
      secret: 'sk-api-key',
      type: 'api',
    })

    const listed = await vault.list()
    expect(listed).toEqual(
      expect.arrayContaining([
        { providerId: 'openai', type: 'api' },
        { providerId: 'openai', type: 'oauth' },
      ]),
    )

    await vault.delete('openai', 'oauth')
    expect(await vault.get('openai')).toEqual({
      providerId: 'openai',
      secret: 'sk-api-key',
      type: 'api',
    })
  })

  it('migrates legacy single-blob vault entries', async () => {
    const storage = createMemoryStorage()
    const key = await generateVaultKey()
    const encrypted = await encryptAesGcm(key, 'sk-legacy')
    await storage.setLocal(VAULT_META_KEY, await exportKeyRaw(key))
    await storage.setLocal(VAULT_LOCAL_KEY, {
      openai: { type: 'api', ciphertext: encrypted.ciphertext, iv: encrypted.iv },
    })

    const vault = new CredentialVault(storage)
    expect(await vault.get('openai')).toEqual({
      providerId: 'openai',
      secret: 'sk-legacy',
      type: 'api',
    })
  })

  it('delete removes a single credential', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-a')
    await vault.set('anthropic', 'sk-b')
    await vault.delete('openai')
    expect(await vault.get('openai')).toBeUndefined()
    expect(await vault.get('anthropic')).toEqual({
      providerId: 'anthropic',
      secret: 'sk-b',
      type: 'api',
    })
  })

  it('clear removes all vault entries and key material', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)
    await vault.set('openai', 'sk-a')
    await vault.set('anthropic', 'sk-b')
    await vault.clear()
    expect(await vault.list()).toEqual([])
    expect(await vault.get('openai')).toBeUndefined()
    expect(await storage.getLocal(VAULT_LOCAL_KEY)).toBeUndefined()
    expect(await storage.getLocal(VAULT_META_KEY)).toBeUndefined()

    // After clear, a new key is minted and credentials work again
    await vault.set('openai', 'sk-fresh')
    expect(await vault.get('openai')).toEqual({
      providerId: 'openai',
      secret: 'sk-fresh',
      type: 'api',
    })
  })

  it('never writes secrets or vault blobs to sync storage', async () => {
    const storage = createMemoryStorage()
    const vault = new CredentialVault(storage)
    await storage.setSync('browser-agent.config', { executionMode: 'ask' })
    await vault.set('openai', 'sk-must-not-sync')
    await vault.set('anthropic', 'sk-also-local', 'oauth')

    expect(await storage.getSync(VAULT_LOCAL_KEY)).toBeUndefined()
    expect(await storage.getSync(VAULT_META_KEY)).toBeUndefined()
    expect(JSON.stringify(await storage.getSync('browser-agent.config'))).not.toContain('sk-')
    expect(await storage.getLocal(VAULT_LOCAL_KEY)).toBeDefined()
    expect(await storage.getLocal(VAULT_META_KEY)).toBeDefined()
  })

  it('reuses persisted key across vault instances', async () => {
    const storage = createMemoryStorage()
    const first = new CredentialVault(storage)
    await first.set('openai', 'sk-persisted')

    const second = new CredentialVault(storage)
    expect(await second.get('openai')).toEqual({
      providerId: 'openai',
      secret: 'sk-persisted',
      type: 'api',
    })

    const meta = await storage.getLocal<string>(VAULT_META_KEY)
    expect(meta).toBeTruthy()
    const key = await importKeyRaw(meta!)
    const store = await storage.getLocal<
      Record<string, { api?: { ciphertext: string; iv: string }; oauth?: { ciphertext: string; iv: string } }>
    >(VAULT_LOCAL_KEY)
    const decrypted = await decryptAesGcm(key, store!.openai!.api!)
    expect(decrypted).toBe('sk-persisted')
  })
})
