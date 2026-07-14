import {
  ConfigService,
  createChromeStorage,
  createResponse,
  IndexedDbSessionStore,
  ModelsDevService,
  type Envelope,
} from '@browser-agent/core'
import { createMessageBus, runDemoStream } from './bus.js'

const storage = createChromeStorage()
const config = new ConfigService(storage)
const models = new ModelsDevService(storage)
const sessions = new IndexedDbSessionStore()
const bus = createMessageBus()

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

bus
  .on('ping', (message) => createResponse(message, 'pong', { ok: true, ts: Date.now() }))
  .on('config.get', async (message) => createResponse(message, 'config.get', await config.get()))
  .on('config.set', async (message) =>
    createResponse(message, 'config.set', await config.set((message.payload ?? {}) as never)),
  )
  .on('session.list', async (message) =>
    createResponse(message, 'session.list', await sessions.listSessions()),
  )
  .on('session.create', async (message) => {
    const payload = (message.payload ?? {}) as { title?: string; agent?: string; model?: string }
    const session = await sessions.createSession({
      title: payload.title,
      agent: payload.agent ?? 'browse',
      model: payload.model,
    })
    return createResponse(message, 'session.create', session)
  })
  .on('session.get', async (message) => {
    const payload = (message.payload ?? {}) as { id: string }
    return createResponse(message, 'session.get', await sessions.getTranscript(payload.id))
  })
  .onPort('stream.demo', async (message: Envelope, port) => {
    await runDemoStream(bus, port, message)
  })

bus.listen()

// Warm models.dev cache in background (non-blocking)
void models.listProviders().catch(() => undefined)

console.info('[browser-agent] service worker ready')
