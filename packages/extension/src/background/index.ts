import {
  ConfigService,
  createChromeStorage,
  createEnvelope,
  IndexedDbSessionStore,
  ModelsDevService,
  type Envelope,
} from '@browser-agent/core'

const storage = createChromeStorage()
const config = new ConfigService(storage)
const models = new ModelsDevService(storage)
const sessions = new IndexedDbSessionStore()

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
  void config.get()
})

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-side-panel') return
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.windowId != null) {
      void chrome.sidePanel.open({ windowId: tab.windowId })
    }
  })
})

async function handleMessage(message: Envelope): Promise<Envelope> {
  switch (message.type) {
    case 'ping':
      return createEnvelope('pong', { ok: true, ts: Date.now() }, message.id)
    case 'config.get':
      return createEnvelope('config.get', await config.get(), message.id)
    case 'config.set':
      return createEnvelope('config.set', await config.set((message.payload ?? {}) as never), message.id)
    case 'session.list':
      return createEnvelope('session.list', await sessions.listSessions(), message.id)
    case 'session.create': {
      const payload = (message.payload ?? {}) as { title?: string; agent?: string; model?: string }
      const session = await sessions.createSession({
        title: payload.title,
        agent: payload.agent ?? 'browse',
        model: payload.model,
      })
      return createEnvelope('session.create', session, message.id)
    }
    case 'session.get': {
      const payload = (message.payload ?? {}) as { id: string }
      return createEnvelope('session.get', await sessions.getTranscript(payload.id), message.id)
    }
    default:
      return createEnvelope('error', { message: `Unhandled message type: ${message.type}` }, message.id)
  }
}

chrome.runtime.onMessage.addListener((message: Envelope, _sender, sendResponse) => {
  void handleMessage(message)
    .then(sendResponse)
    .catch((err: unknown) => {
      sendResponse(
        createEnvelope('error', { message: err instanceof Error ? err.message : String(err) }, message?.id),
      )
    })
  return true
})

// Warm models.dev cache in background (non-blocking)
void models.listProviders().catch(() => undefined)

console.info('[browser-agent] service worker ready')
