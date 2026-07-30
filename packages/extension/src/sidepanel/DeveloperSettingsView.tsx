import { useCallback, useEffect, useState } from 'react'
import type { AppConfigType } from '@browser-agent/core'
import { sendRequest } from './client.js'

function developerModeFromResponse(response: Awaited<ReturnType<typeof sendRequest>>): boolean {
  if (response.type === 'error') {
    throw new Error(String((response.payload as { message?: string })?.message))
  }
  return (response.payload as AppConfigType).settings.developerMode
}

export function DeveloperSettingsView({ hidden }: { hidden: boolean }) {
  const [developerMode, setDeveloperMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setDeveloperMode(developerModeFromResponse(await sendRequest('config.get')))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function updateDeveloperMode(enabled: boolean) {
    setSaving(true)
    setError(null)
    try {
      setDeveloperMode(
        developerModeFromResponse(
          await sendRequest('config.set', { settings: { developerMode: enabled } }),
        ),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section
      className="settings-section"
      id="developer"
      hidden={hidden}
      aria-labelledby="developer-heading"
    >
      <div className="settings-section-heading">
        <h2 id="developer-heading">Developer</h2>
        <p className="settings-section-desc">
          Enable advanced Browser Agent features separately from everyday setup.
        </p>
      </div>

      <div className="settings-field">
        <label className="settings-enable" htmlFor="developer-mode-toggle">
          <input
            id="developer-mode-toggle"
            type="checkbox"
            checked={developerMode}
            disabled={loading || saving}
            aria-describedby="developer-mode-hint"
            onChange={(event) => void updateDeveloperMode(event.target.checked)}
          />
          Enable Browser Agent Developer Mode
        </label>
        <p className="settings-hint" id="developer-mode-hint">
          This preference does not control Chrome&apos;s extension Developer Mode, which is managed
          from chrome://extensions and may be restricted by an administrator.
        </p>
      </div>

      {error ? <p className="settings-error">{error}</p> : null}
    </section>
  )
}
