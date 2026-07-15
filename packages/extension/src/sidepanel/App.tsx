import { useEffect, useState } from 'react'
import { listVisibleAgents, type AgentInfo } from '@browser-agent/core'
import { sendRequest } from './client.js'
import { ChatView } from './Chat.js'
import { SettingsView } from './Settings.js'
import { ThemeProvider, useTheme, type ThemeMode } from './ThemeProvider.js'

type View = 'chat' | 'settings'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

function AppContent() {
  const { mode, setMode } = useTheme()
  const [view, setView] = useState<View>('chat')
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState('browse')

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

  useEffect(() => {
    let cancelled = false
    void sendRequest('config.get')
      .then((response) => {
        if (cancelled || response.type === 'error') return
        const config = response.payload as Parameters<typeof listVisibleAgents>[0]
        const visible = listVisibleAgents(config)
        setAgents(visible)
        if (visible.some((agent) => agent.name === 'browse')) {
          setSelectedAgent('browse')
        } else if (visible[0]) {
          setSelectedAgent(visible[0].name)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="header-start">
          <div className="brand">Browser Agent</div>
          {agents.length > 0 ? (
            <label className="agent-picker">
              <span className="agent-picker-label">Agent</span>
              <select
                className="agent-picker-select"
                value={selectedAgent}
                onChange={(event) => setSelectedAgent(event.target.value)}
              >
                {agents.map((agent) => (
                  <option key={agent.name} value={agent.name}>
                    {agent.name}
                    {agent.description ? ` — ${agent.description}` : ''}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        <div className="header-end">
          <div className="theme-toggle" role="group" aria-label="Theme">
            {THEME_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`theme-toggle-btn${mode === opt.value ? ' active' : ''}`}
                aria-pressed={mode === opt.value}
                onClick={() => setMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className={`status status-${status}`}>{status}</div>
        </div>
      </header>

      <main className="main main-fill">
        {view === 'chat' ? <ChatView selectedAgent={selectedAgent} /> : <SettingsView />}
      </main>

      <nav className="nav" aria-label="Main navigation">
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

export function App() {
  return (
    <ThemeProvider>
      <AppContent />
    </ThemeProvider>
  )
}
