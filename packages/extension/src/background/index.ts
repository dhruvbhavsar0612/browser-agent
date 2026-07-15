import {
  ConfigService,
  CredentialVault,
  createChromeStorage,
  createResponse,
  IndexedDbSessionStore,
  ModelsDevService,
  isModelEnabled,
  parseModelRef,
  type Envelope,
} from '@browser-agent/core'
import { createMessageBus, runDemoStream } from './bus.js'
import { registerAgentHandlers } from './handlers/agent.js'
import { registerOAuthHandlers } from './handlers/oauth.js'
import { registerSettingsHandlers } from './handlers/settings.js'

const storage = createChromeStorage()
const config = new ConfigService(storage)
const models = new ModelsDevService(storage)
const vault = new CredentialVault(storage)
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
    const appConfig = await config.get()
    const model = payload.model ?? appConfig.model
    if (model) {
      const ref = parseModelRef(model)
      if (!isModelEnabled(appConfig, ref.providerID, ref.modelID)) {
        throw new Error(`Model "${model}" is not enabled`)
      }
    }
    const session = await sessions.createSession({
      title: payload.title,
      agent: payload.agent ?? 'browse',
      model,
    })
    return createResponse(message, 'session.create', session)
  })
  .on('session.update', async (message) => {
    const payload = (message.payload ?? {}) as {
      id: string
      title?: string
      agent?: string
      model?: string
    }
    const updated = await sessions.updateSession(payload.id, {
      title: payload.title,
      agent: payload.agent,
      model: payload.model,
    })
    return createResponse(message, 'session.update', updated)
  })
  .on('session.delete', async (message) => {
    const payload = (message.payload ?? {}) as { id: string }
    await sessions.deleteSession(payload.id)
    return createResponse(message, 'session.delete', { ok: true })
  })
  .on('session.get', async (message) => {
    const payload = (message.payload ?? {}) as { id: string }
    return createResponse(message, 'session.get', await sessions.getTranscript(payload.id))
  })
  .onPort('stream.demo', async (message: Envelope, port) => {
    await runDemoStream(bus, port, message)
  })

registerSettingsHandlers(bus, { vault, models, config })
registerAgentHandlers(bus, { config, vault, sessions, models })
registerOAuthHandlers(bus, { vault })

bus.listen()

console.info('[browser-agent] service worker ready')
