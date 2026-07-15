import { useCallback, useEffect, useState } from 'react'
import {
  listVisibleAgents,
  type AgentInfo,
  type AppConfigType,
  type ExecutionMode,
  type SessionRecord,
} from '@browser-agent/core'
import { sendRequest } from './client.js'
import { ChatView } from './Chat.js'
import { SessionSwitcher } from './SessionSwitcher.js'
import { SettingsView } from './Settings.js'
import { ThemeProvider, useTheme, type ThemeMode } from './ThemeProvider.js'

type View = 'chat' | 'settings'

const THEME_OPTIONS: { value: ThemeMode; label: string }[] = [
  { value: 'system', label: 'Auto' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

const EXECUTION_OPTIONS: { value: ExecutionMode; label: string; title: string }[] = [
  { value: 'plan', label: 'Plan', title: 'Read-only — blocks click/type/navigate' },
  { value: 'approval', label: 'Ask', title: 'Prompt before write actions' },
  { value: 'auto', label: 'Auto', title: 'Allow tools unless denied by rules' },
]

function AppContent() {
  const { mode, setMode } = useTheme()
  const [view, setView] = useState<View>('chat')
  const [status, setStatus] = useState<'checking' | 'ok' | 'error'>('checking')
  const [agents, setAgents] = useState<AgentInfo[]>([])
  const [selectedAgent, setSelectedAgent] = useState('browse')
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('approval')

  const refreshSessions = useCallback(() => {
    void sendRequest('session.list')
      .then((response) => {
        if (response.type === 'error') return
        setSessions((response.payload ?? []) as SessionRecord[])
      })
      .catch(() => undefined)
  }, [])

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
        const config = response.payload as AppConfigType
        const visible = listVisibleAgents(config)
        setAgents(visible)
        if (config.executionMode) setExecutionMode(config.executionMode)
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

  const saveExecutionMode = useCallback((next: ExecutionMode) => {
    setExecutionMode(next)
    void sendRequest('config.set', { executionMode: next }).catch(() => undefined)
  }, [])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  const activeTitle =
    sessions.find((session) => session.id === activeSessionId)?.title ?? 'New chat'

  const onNewChat = useCallback(() => {
    setActiveSessionId(null)
    setView('chat')
  }, [])

  const onSelectSession = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId)
    setView('chat')
  }, [])

  const onDeleteSession = useCallback(
    (sessionId: string) => {
      void sendRequest('session.delete', { id: sessionId })
        .then(() => {
          if (activeSessionId === sessionId) {
            setActiveSessionId(null)
          }
          refreshSessions()
        })
        .catch(() => undefined)
    },
    [activeSessionId, refreshSessions],
  )

  const onSessionChange = useCallback((session: SessionRecord | null) => {
    setActiveSessionId(session?.id ?? null)
  }, [])

  return (
    <div className="app">
      <header className="header">
        <div className="header-start">
          <div className="brand">Browser Agent</div>
          <SessionSwitcher
            sessions={sessions}
            activeSessionId={activeSessionId}
            activeTitle={activeTitle}
            onSelect={onSelectSession}
            onNewChat={onNewChat}
            onDelete={onDeleteSession}
          />
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
          <div className="theme-toggle" role="group" aria-label="Execution mode">
            {EXECUTION_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`theme-toggle-btn${executionMode === opt.value ? ' active' : ''}`}
                aria-pressed={executionMode === opt.value}
                title={opt.title}
                onClick={() => saveExecutionMode(opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
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
        {view === 'chat' ? (
          <ChatView
            key={activeSessionId ?? 'new'}
            selectedAgent={selectedAgent}
            sessionId={activeSessionId}
            onSessionChange={onSessionChange}
            onSessionsRefresh={refreshSessions}
          />
        ) : (
          <SettingsView />
        )}
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
