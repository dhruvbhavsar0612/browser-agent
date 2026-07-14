import { useEffect, useState } from 'react'
import { sendRequest } from './client.js'
import { ChatView } from './Chat.js'
import { SettingsView } from './Settings.js'

type View = 'chat' | 'settings'

export function App() {
  const [view, setView] = useState<View>('chat')
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')

  useEffect(() => {
    let cancelled = false
    void sendRequest('ping')
      .then((response) => {
        if (cancelled) return
        setStatus(response.type === 'pong' ? 'ok' : 'error')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
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

      <main className="main main-fill">{view === 'chat' ? <ChatView /> : <SettingsView />}</main>

      <nav className="nav">
        <button
          type="button"
          className={`nav-item ${view === 'chat' ? 'active' : ''}`}
          onClick={() => setView('chat')}
        >
          Chat
        </button>
        <button
          type="button"
          className={`nav-item ${view === 'settings' ? 'active' : ''}`}
          onClick={() => setView('settings')}
        >
          Settings
        </button>
      </nav>
    </div>
  )
}
