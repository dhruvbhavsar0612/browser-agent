import {
  CredentialVault,
  buildAuthorizeUrl,
  createResponse,
  exchangeAuthorizationCode,
  isOAuthProviderId,
  type Envelope,
  type OAuthPending,
  type OAuthProviderId,
} from '@browser-agent/core'
import type { MessageBus } from '../bus.js'

const PENDING_KEY = 'browser-agent.oauth-pending'
const CONNECT_TIMEOUT_MS = 5 * 60 * 1000

type PendingRecord = OAuthPending & {
  tabId?: number
  callbackUrlPrefix: string
}

type PendingMap = Record<string, PendingRecord>

const activeListeners = new Map<string, () => void>()

async function readPending(): Promise<PendingMap> {
  const result = await chrome.storage.session.get(PENDING_KEY)
  const value = result[PENDING_KEY]
  return value && typeof value === 'object' ? (value as PendingMap) : {}
}

async function writePending(map: PendingMap): Promise<void> {
  await chrome.storage.session.set({ [PENDING_KEY]: map })
}

async function clearPending(providerId: string): Promise<void> {
  activeListeners.get(providerId)?.()
  activeListeners.delete(providerId)
  const map = await readPending()
  delete map[providerId]
  await writePending(map)
}

/**
 * Watch for OAuth redirect navigation. Codex/Claude clients use fixed redirect
 * URIs that chrome.identity cannot capture, so we observe chrome.tabs updates.
 * When the callback is seen, exchange the code and store the token automatically.
 */
function watchCallbackTab(
  providerId: OAuthProviderId,
  callbackUrlPrefix: string,
  tabId: number,
  vault: CredentialVault,
): void {
  activeListeners.get(providerId)?.()

  const timer = setTimeout(() => {
    cleanup()
  }, CONNECT_TIMEOUT_MS)

  const onUpdated = (
    updatedTabId: number,
    changeInfo: chrome.tabs.TabChangeInfo,
    tab: chrome.tabs.Tab,
  ) => {
    if (updatedTabId !== tabId) return
    const url = changeInfo.url ?? tab.url
    if (!url || !url.startsWith(callbackUrlPrefix)) return
    cleanup()
    void completeFromCallback(providerId, url, tabId, vault)
  }

  const onRemoved = (removedTabId: number) => {
    if (removedTabId !== tabId) return
    cleanup()
  }

  function cleanup() {
    clearTimeout(timer)
    chrome.tabs.onUpdated.removeListener(onUpdated)
    chrome.tabs.onRemoved.removeListener(onRemoved)
    activeListeners.delete(providerId)
  }

  activeListeners.set(providerId, cleanup)
  chrome.tabs.onUpdated.addListener(onUpdated)
  chrome.tabs.onRemoved.addListener(onRemoved)
}

async function completeFromCallback(
  providerId: OAuthProviderId,
  callbackUrl: string,
  tabId: number,
  vault: CredentialVault,
): Promise<void> {
  try {
    const pendingMap = await readPending()
    const pending = pendingMap[providerId]
    if (!pending) return
    const result = await exchangeAuthorizationCode(pending, callbackUrl)
    await vault.set(result.providerId, result.secret, 'oauth')
    await clearPending(providerId)
    try {
      await chrome.tabs.remove(tabId)
    } catch {
      // Tab may already be closed
    }
  } catch (err) {
    console.warn('[browser-agent] OAuth callback exchange failed', err)
  }
}

/**
 * Prefer chrome.identity.launchWebAuthFlow when redirect is extension-owned
 * (`*.chromiumapp.org`). Returns null for Codex/Claude fixed redirects.
 */
async function tryIdentityFlow(authUrl: string, redirectUri: string): Promise<string | null> {
  if (typeof chrome.identity?.launchWebAuthFlow !== 'function') return null
  if (!redirectUri.includes('chromiumapp.org')) return null

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (responseUrl) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message))
        return
      }
      if (!responseUrl) {
        reject(new Error('OAuth cancelled'))
        return
      }
      resolve(responseUrl)
    })
  })
}

export interface OAuthHandlerDeps {
  vault: CredentialVault
}

export function registerOAuthHandlers(bus: MessageBus, deps: OAuthHandlerDeps): void {
  const { vault } = deps

  bus
    .on('oauth.connect', async (message) => {
      const payload = (message.payload ?? {}) as {
        providerId?: string
        mode?: 'max' | 'console'
      }
      const providerId = payload.providerId?.trim()
      if (!providerId || !isOAuthProviderId(providerId)) {
        throw new Error('providerId must be openai or anthropic')
      }

      await clearPending(providerId)

      const authorize = await buildAuthorizeUrl(providerId, { mode: payload.mode })

      // Prefer chrome.identity when redirect is extension-owned
      try {
        const identityUrl = await tryIdentityFlow(authorize.authUrl, authorize.pending.redirectUri)
        if (identityUrl) {
          const result = await exchangeAuthorizationCode(authorize.pending, identityUrl)
          await vault.set(result.providerId, result.secret, 'oauth')
          const entries = await vault.list()
          return createResponse(message, 'oauth.connect', {
            ok: true,
            providerId,
            connected: true,
            entries,
          })
        }
      } catch {
        // Fall through to tab + paste flow
      }

      const tab = await chrome.tabs.create({ url: authorize.authUrl, active: true })
      const pendingMap = await readPending()
      pendingMap[providerId] = {
        ...authorize.pending,
        tabId: tab.id,
        callbackUrlPrefix: authorize.callbackUrlPrefix,
      }
      await writePending(pendingMap)

      if (tab.id != null) {
        watchCallbackTab(providerId, authorize.callbackUrlPrefix, tab.id, vault)
      }

      // Return immediately — UI can poll vault.list or paste a code via oauth.complete
      return createResponse(message, 'oauth.connect', {
        ok: true,
        providerId,
        connected: false,
        pending: true,
        manual: true,
        authUrl: authorize.authUrl,
      })
    })
    .on('oauth.complete', async (message) => {
      const payload = (message.payload ?? {}) as {
        providerId?: string
        code?: string
      }
      const providerId = payload.providerId?.trim() as OAuthProviderId | undefined
      const code = payload.code?.trim()
      if (!providerId || !isOAuthProviderId(providerId)) {
        throw new Error('providerId must be openai or anthropic')
      }
      if (!code) {
        throw new Error('Authorization code is required')
      }

      const pendingMap = await readPending()
      const pending = pendingMap[providerId]
      if (!pending) {
        throw new Error('No pending OAuth flow — click Connect first')
      }
      if (Date.now() - pending.createdAt > CONNECT_TIMEOUT_MS) {
        await clearPending(providerId)
        throw new Error('OAuth flow expired — click Connect again')
      }

      const result = await exchangeAuthorizationCode(pending, code)
      await vault.set(result.providerId, result.secret, 'oauth')
      if (pending.tabId != null) {
        try {
          await chrome.tabs.remove(pending.tabId)
        } catch {
          // ignore
        }
      }
      await clearPending(providerId)
      const entries = await vault.list()
      return createResponse(message, 'oauth.complete', {
        ok: true,
        providerId,
        connected: true,
        entries,
      })
    })
    .on('oauth.disconnect', async (message) => {
      const payload = (message.payload ?? {}) as { providerId?: string }
      const providerId = payload.providerId?.trim()
      if (!providerId) {
        throw new Error('providerId is required')
      }
      await vault.delete(providerId, 'oauth')
      await clearPending(providerId)
      const entries = await vault.list()
      return createResponse(message, 'oauth.disconnect', { ok: true, providerId, entries })
    })
}

/** @internal test helper */
export async function dispatchOAuthMessage(bus: MessageBus, message: Envelope): Promise<Envelope> {
  return bus.dispatch(message, {} as chrome.runtime.MessageSender)
}
