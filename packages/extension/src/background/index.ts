import { createEnvelope, type Envelope } from '@browser-agent/core'

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
})

chrome.commands.onCommand.addListener((command) => {
  if (command !== 'toggle-side-panel') return
  void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
    if (tab?.windowId != null) {
      void chrome.sidePanel.open({ windowId: tab.windowId })
    }
  })
})

chrome.runtime.onMessage.addListener((message: Envelope, _sender, sendResponse) => {
  if (message?.type === 'ping') {
    sendResponse(createEnvelope('pong', { ok: true, ts: Date.now() }, message.id))
    return true
  }
  return false
})

console.info('[browser-agent] service worker ready')
