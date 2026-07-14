import { useEffect, useState } from 'react'
import { createEnvelope, type Envelope } from '@browser-agent/core'

export function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [detail, setDetail] = useState('Connecting to service worker…')

  useEffect(() => {
    const msg = createEnvelope('ping')
    chrome.runtime.sendMessage(msg, (response: Envelope | undefined) => {
      if (chrome.runtime.lastError) {
        setStatus('error')
        setDetail(chrome.runtime.lastError.message ?? 'Unknown error')
        return
      }
      if (response?.type === 'pong') {
        setStatus('ok')
        setDetail('Service worker connected')
        return
      }
      setStatus('error')
      setDetail('Unexpected response')
    })
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="brand">Browser Agent</div>
        <div className={`status status-${status}`}>{status}</div>
      </header>

      <main className="main">
        <h1>Ready to build</h1>
        <p className="lede">{detail}</p>
        <p className="hint">
          Sprint 0 shell. Add a provider key in Settings (Sprint 1) to start chatting.
        </p>
      </main>

      <nav className="nav">
        <button type="button" className="nav-item active">
          Chat
        </button>
        <button type="button" className="nav-item" disabled>
          Settings
        </button>
      </nav>
    </div>
  )
}
