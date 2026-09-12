import { useCallback, useEffect, useState, type ReactNode } from 'react'

export const SETTINGS_VIEWS = [
  { id: 'providers', label: 'Providers' },
  { id: 'connectors', label: 'Connectors' },
  { id: 'permissions', label: 'Permissions' },
  { id: 'agent', label: 'Agent' },
  { id: 'developer', label: 'Developer' },
] as const

export type SettingsViewId = (typeof SETTINGS_VIEWS)[number]['id']

export const DEFAULT_SETTINGS_VIEW: SettingsViewId = 'connectors'

export function viewFromSettingsHash(hash: string): SettingsViewId | null {
  const value = hash.replace(/^#/, '').toLowerCase()
  return SETTINGS_VIEWS.some((view) => view.id === value) ? (value as SettingsViewId) : null
}

function initialSettingsView(): SettingsViewId {
  if (typeof window === 'undefined') return DEFAULT_SETTINGS_VIEW
  return viewFromSettingsHash(window.location.hash) ?? DEFAULT_SETTINGS_VIEW
}

export function SettingsShell({
  children,
}: {
  children: (activeView: SettingsViewId) => ReactNode
}) {
  const [activeView, setActiveView] = useState<SettingsViewId>(initialSettingsView)

  useEffect(() => {
    const syncViewFromHash = () => {
      setActiveView(viewFromSettingsHash(window.location.hash) ?? DEFAULT_SETTINGS_VIEW)
    }

    window.addEventListener('hashchange', syncViewFromHash)
    return () => window.removeEventListener('hashchange', syncViewFromHash)
  }, [])

  const selectView = useCallback((view: SettingsViewId) => {
    setActiveView(view)
    if (window.location.hash !== `#${view}`) {
      window.location.hash = view
    }
  }, [])

  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings views">
        {SETTINGS_VIEWS.map((view) => (
          <button
            key={view.id}
            type="button"
            className={`settings-nav-item${activeView === view.id ? ' settings-nav-item-active' : ''}`}
            aria-current={activeView === view.id ? 'page' : undefined}
            onClick={() => selectView(view.id)}
          >
            {view.label}
          </button>
        ))}
      </nav>

      <main className="settings-main">{children(activeView)}</main>
    </div>
  )
}
