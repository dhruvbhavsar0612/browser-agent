import { useEffect, useState } from 'react'
import { sendRequest } from './client.js'

export function App() {
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [detail, setDetail] = useState('Connecting to service worker…')

  useEffect(() => {
    let cancelled = false
    void sendRequest('ping')
      .then((response) => {
        if (cancelled) return
        if (response.type === 'pong') {
          setStatus('ok')
          setDetail('Service worker connected')
          return
        }
        setStatus('error')
        setDetail(`Unexpected response: ${response.type}`)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus('error')
        setDetail(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
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
          Runtime ready: vault, providers, message bus, permissions. Settings + chat next.
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
