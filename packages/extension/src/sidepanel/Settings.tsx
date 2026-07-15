import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  SENSITIVE_DEFAULT_RULES,
  evaluate,
  fromConfig,
  rulesForExecutionMode,
  type AppConfigType,
  type ProviderInfo,
  type VaultListEntry,
} from '@browser-agent/core'
import { sendRequest } from './client.js'
import './Settings.css'

const KEY_PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic' },
  { id: 'openai', label: 'OpenAI' },
  { id: 'google', label: 'Google' },
  { id: 'openrouter', label: 'OpenRouter' },
  { id: 'openai-compatible', label: 'OpenAI-compatible' },
] as const

type KeyProviderId = (typeof KEY_PROVIDERS)[number]['id']

type TestState = 'idle' | 'testing' | 'ok' | 'error'

function hasKey(entries: VaultListEntry[], providerId: string): boolean {
  return entries.some((entry) => entry.providerId === providerId)
}

function modelLabel(model: { name: string; toolCall: boolean; vision: boolean; context: number }): string {
  const tags: string[] = []
  if (model.toolCall) tags.push('tools')
  if (model.vision) tags.push('vision')
  if (model.context > 0) tags.push(`${Math.round(model.context / 1000)}k ctx`)
  return tags.length > 0 ? `${model.name} (${tags.join(', ')})` : model.name
}

export function SettingsView() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [compatibleError, setCompatibleError] = useState<string | null>(null)
  const [vaultEntries, setVaultEntries] = useState<VaultListEntry[]>([])
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [config, setConfig] = useState<AppConfigType | null>(null)
  const [keyInputs, setKeyInputs] = useState<Partial<Record<KeyProviderId, string>>>({})
  const [baseURL, setBaseURL] = useState('')
  const [selectedModel, setSelectedModel] = useState('')
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savingModel, setSavingModel] = useState(false)
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [testState, setTestState] = useState<TestState>('idle')
  const [testMessage, setTestMessage] = useState('')

  const applyModelsResponse = useCallback((modelsRes: Awaited<ReturnType<typeof sendRequest>>) => {
    if (modelsRes.type === 'error') {
      throw new Error(String((modelsRes.payload as { message?: string })?.message))
    }
    const catalog = ((modelsRes.payload as { providers?: ProviderInfo[] })?.providers ??
      []) as ProviderInfo[]
    const remoteError = (modelsRes.payload as { compatibleError?: string | null })?.compatibleError
    setProviders(catalog)
    setCompatibleError(remoteError ? String(remoteError) : null)
  }, [])

  const refreshModels = useCallback(
    async (opts?: { forceRefresh?: boolean }) => {
      setRefreshingModels(true)
      try {
        const modelsRes = await sendRequest('models.list', {
          forceRefresh: opts?.forceRefresh ?? true,
        })
        applyModelsResponse(modelsRes)
      } finally {
        setRefreshingModels(false)
      }
    },
    [applyModelsResponse],
  )

  const load = useCallback(async () => {
    setError(null)
    try {
      const [vaultRes, modelsRes, configRes] = await Promise.all([
        sendRequest('vault.list'),
        sendRequest('models.list'),
        sendRequest('config.get'),
      ])

      if (vaultRes.type === 'error') throw new Error(String((vaultRes.payload as { message?: string })?.message))
      if (configRes.type === 'error') throw new Error(String((configRes.payload as { message?: string })?.message))

      const entries = ((vaultRes.payload as { entries?: VaultListEntry[] })?.entries ?? []) as VaultListEntry[]
      const cfg = configRes.payload as AppConfigType

      applyModelsResponse(modelsRes)
      setVaultEntries(entries)
      setConfig(cfg)
      setSelectedModel(cfg.model ?? '')
      setBaseURL(
        cfg.provider['openai-compatible']?.api ??
          (cfg.provider['openai-compatible']?.options as { baseURL?: string } | undefined)?.baseURL ??
          '',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [applyModelsResponse])

  useEffect(() => {
    void load()
  }, [load])

  const modelOptions = useMemo(() => {
    return providers
      .filter((provider) => provider.models.length > 0)
      .map((provider) => ({
        provider,
        models: [...provider.models].sort((a, b) => a.name.localeCompare(b.name)),
      }))
  }, [providers])

  const compatibleModelCount =
    providers.find((provider) => provider.id === 'openai-compatible')?.models.length ?? 0

  async function saveKey(providerId: KeyProviderId) {
    const secret = keyInputs[providerId]?.trim()
    if (!secret) return

    setSavingKey(providerId)
    setError(null)
    try {
      const response = await sendRequest('vault.set', { providerId, secret })
      if (response.type === 'error') {
        throw new Error(String((response.payload as { message?: string })?.message))
      }
      const entries = ((response.payload as { entries?: VaultListEntry[] })?.entries ?? []) as VaultListEntry[]
      setVaultEntries(entries)
      setKeyInputs((prev) => ({ ...prev, [providerId]: '' }))
      if (providerId === 'openai-compatible' && baseURL.trim()) {
        await refreshModels()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingKey(null)
    }
  }

  async function saveBaseURL() {
    if (!config) return
    const trimmed = baseURL.trim()
    const response = await sendRequest('config.set', {
      provider: {
        ...config.provider,
        'openai-compatible': {
          ...config.provider['openai-compatible'],
          api: trimmed || undefined,
        },
      },
    })
    if (response.type === 'error') {
      throw new Error(String((response.payload as { message?: string })?.message))
    }
    setConfig(response.payload as AppConfigType)
    if (trimmed) {
      await refreshModels()
    } else {
      setCompatibleError(null)
      setProviders((prev) => prev.filter((provider) => provider.id !== 'openai-compatible'))
    }
  }

  async function deleteKey(providerId: string) {
    setError(null)
    try {
      const response = await sendRequest('vault.delete', { providerId })
      if (response.type === 'error') {
        throw new Error(String((response.payload as { message?: string })?.message))
      }
      const entries = ((response.payload as { entries?: VaultListEntry[] })?.entries ?? []) as VaultListEntry[]
      setVaultEntries(entries)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function clearAllKeys() {
    if (!window.confirm('Remove all stored API keys?')) return
    setError(null)
    try {
      const response = await sendRequest('vault.clear')
      if (response.type === 'error') {
        throw new Error(String((response.payload as { message?: string })?.message))
      }
      setVaultEntries([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function saveModel(model: string) {
    setSelectedModel(model)
    setSavingModel(true)
    setError(null)
    try {
      const response = await sendRequest('config.set', { model: model || undefined })
      if (response.type === 'error') {
        throw new Error(String((response.payload as { message?: string })?.message))
      }
      setConfig(response.payload as AppConfigType)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSavingModel(false)
    }
  }

  async function testModel() {
    setTestState('testing')
    setTestMessage('')
    setError(null)
    try {
      const response = await sendRequest('model.test', selectedModel ? { model: selectedModel } : {})
      if (response.type === 'error') {
        throw new Error(String((response.payload as { message?: string })?.message))
      }
      const result = response.payload as { ok: boolean; text?: string; error?: string }
      if (result.ok) {
        setTestState('ok')
        setTestMessage(result.text ? `Response: ${result.text}` : 'Model responded successfully.')
      } else {
        setTestState('error')
        setTestMessage(result.error ?? 'Model test failed.')
      }
    } catch (err) {
      setTestState('error')
      setTestMessage(err instanceof Error ? err.message : String(err))
    }
  }

  if (loading) {
    return (
      <div className="settings">
        <p className="settings-loading">Loading settings…</p>
      </div>
    )
  }

  return (
    <div className="settings">
      <div>
        <h1>Settings</h1>
        <p className="settings-lede">Bring your own API keys. Secrets stay encrypted in local storage only.</p>
      </div>

      {error ? <p className="settings-error">{error}</p> : null}

      <section className="settings-section">
        <h2>API keys</h2>
        {KEY_PROVIDERS.map((provider) => {
          const configured = hasKey(vaultEntries, provider.id)
          return (
            <div key={provider.id} className="settings-provider">
              <div className="settings-provider-header">
                <span className="settings-provider-name">{provider.label}</span>
                <span className={`settings-badge ${configured ? 'settings-badge-ok' : ''}`}>
                  {configured ? 'Key set' : 'Not set'}
                </span>
              </div>

              {provider.id === 'openai-compatible' ? (
                <>
                  <div className="settings-field">
                    <label htmlFor="base-url">Base URL</label>
                    <input
                      id="base-url"
                      className="settings-input"
                      type="url"
                      placeholder="https://opencode.ai/zen/go/v1"
                      value={baseURL}
                      onChange={(e) => setBaseURL(e.target.value)}
                      onBlur={() =>
                        void saveBaseURL().catch((err) =>
                          setError(err instanceof Error ? err.message : String(err)),
                        )
                      }
                    />
                    <p className="settings-hint">
                      Models are loaded from <code>{'{baseURL}'}/models</code> after you save.
                    </p>
                  </div>
                  {compatibleError ? <p className="settings-error">{compatibleError}</p> : null}
                  {!compatibleError && baseURL.trim() && compatibleModelCount > 0 ? (
                    <p className="settings-hint">
                      Loaded {compatibleModelCount} model{compatibleModelCount === 1 ? '' : 's'} from
                      endpoint.
                    </p>
                  ) : null}
                </>
              ) : null}

              <div className="settings-field">
                <label htmlFor={`key-${provider.id}`}>API key</label>
                <input
                  id={`key-${provider.id}`}
                  className="settings-input"
                  type="password"
                  autoComplete="off"
                  placeholder={configured ? 'Enter new key to replace' : 'sk-…'}
                  value={keyInputs[provider.id] ?? ''}
                  onChange={(e) =>
                    setKeyInputs((prev) => ({
                      ...prev,
                      [provider.id]: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="settings-row">
                <button
                  type="button"
                  className="settings-btn settings-btn-primary"
                  disabled={!keyInputs[provider.id]?.trim() || savingKey === provider.id}
                  onClick={() => void saveKey(provider.id)}
                >
                  {savingKey === provider.id ? 'Saving…' : 'Save key'}
                </button>
                {configured ? (
                  <button
                    type="button"
                    className="settings-btn settings-btn-danger"
                    onClick={() => void deleteKey(provider.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}

        <div className="settings-row">
          <button type="button" className="settings-btn settings-btn-danger" onClick={() => void clearAllKeys()}>
            Clear all keys
          </button>
        </div>
      </section>

      <section className="settings-section">
        <h2>Default model</h2>
        <div className="settings-field">
          <label htmlFor="model-select">Model</label>
          <select
            id="model-select"
            className="settings-select"
            value={selectedModel}
            disabled={savingModel}
            onChange={(e) => void saveModel(e.target.value)}
          >
            <option value="">Select a model…</option>
            {modelOptions.map(({ provider, models }) => (
              <optgroup key={provider.id} label={provider.name}>
                {models.map((model) => {
                  const value = `${provider.id}/${model.id}`
                  return (
                    <option key={value} value={value}>
                      {modelLabel(model)}
                    </option>
                  )
                })}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="settings-row">
          <button
            type="button"
            className="settings-btn settings-btn-primary"
            disabled={!selectedModel || testState === 'testing'}
            onClick={() => void testModel()}
          >
            {testState === 'testing' ? 'Testing…' : 'Test model'}
          </button>
          <button
            type="button"
            className="settings-btn"
            disabled={refreshingModels}
            onClick={() =>
              void refreshModels().catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }
          >
            {refreshingModels ? 'Refreshing…' : 'Refresh models'}
          </button>
        </div>

        {testState !== 'idle' ? (
          <div
            className={`settings-status ${
              testState === 'ok'
                ? 'settings-status-ok'
                : testState === 'error'
                  ? 'settings-status-err'
                  : 'settings-status-muted'
            }`}
          >
            {testState === 'testing' ? 'Sending ping…' : testMessage}
          </div>
        ) : null}
      </section>

      <SiteRulesSection config={config} onConfig={setConfig} setError={setError} />
    </div>
  )
}

type SiteRuleDraft = {
  permission: string
  pattern: string
  action: 'allow' | 'ask' | 'deny'
}

function permissionToDrafts(permission: AppConfigType['permission']): SiteRuleDraft[] {
  if (typeof permission === 'string') {
    return [{ permission: '*', pattern: '*', action: permission }]
  }
  const drafts: SiteRuleDraft[] = []
  for (const [tool, value] of Object.entries(permission ?? {})) {
    if (typeof value === 'string') {
      drafts.push({ permission: tool, pattern: '*', action: value })
    } else if (value && typeof value === 'object') {
      for (const [pattern, action] of Object.entries(value)) {
        drafts.push({
          permission: tool,
          pattern,
          action: action as SiteRuleDraft['action'],
        })
      }
    }
  }
  return drafts
}

function draftsToPermission(drafts: SiteRuleDraft[]): AppConfigType['permission'] {
  const next: Record<string, 'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>> =
    {}
  for (const draft of drafts) {
    const permission = draft.permission.trim() || '*'
    const pattern = draft.pattern.trim() || '*'
    if (pattern === '*') {
      next[permission] = draft.action
      continue
    }
    const existing = next[permission]
    if (!existing || typeof existing === 'string') {
      next[permission] = {
        ...(typeof existing === 'string' ? { '*': existing } : {}),
        [pattern]: draft.action,
      }
    } else {
      existing[pattern] = draft.action
    }
  }
  return next
}

function SiteRulesSection({
  config,
  onConfig,
  setError,
}: {
  config: AppConfigType | null
  onConfig: (config: AppConfigType) => void
  setError: (error: string | null) => void
}) {
  const [drafts, setDrafts] = useState<SiteRuleDraft[]>([])
  const [saving, setSaving] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('https://example.com/checkout')
  const [previewTool, setPreviewTool] = useState('click')

  useEffect(() => {
    if (!config) return
    setDrafts(permissionToDrafts(config.permission))
  }, [config])

  const previewAction = useMemo(() => {
    const rules = [
      ...rulesForExecutionMode(config?.executionMode ?? 'approval'),
      ...fromConfig(draftsToPermission(drafts)),
      ...SENSITIVE_DEFAULT_RULES,
    ]
    return evaluate(previewTool, previewUrl, rules).action
  }, [config?.executionMode, drafts, previewTool, previewUrl])

  const save = async () => {
    setSaving(true)
    setError(null)
    try {
      const permission = draftsToPermission(drafts)
      const res = await sendRequest('config.set', { permission })
      if (res.type === 'error') {
        throw new Error(String((res.payload as { message?: string })?.message))
      }
      onConfig(res.payload as AppConfigType)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-section">
      <h2>Site permission rules</h2>
      <p className="settings-hint">
        URL globs per tool. Sensitive paths (checkout / payment / login) are denied by default and
        always win.
      </p>

      <div className="settings-rules">
        {drafts.map((draft, index) => (
          <div className="settings-rule-row" key={`${draft.permission}-${index}`}>
            <input
              className="settings-input"
              value={draft.permission}
              placeholder="click"
              aria-label="Permission"
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((item, i) =>
                    i === index ? { ...item, permission: e.target.value } : item,
                  ),
                )
              }
            />
            <input
              className="settings-input"
              value={draft.pattern}
              placeholder="https://github.com/*"
              aria-label="URL pattern"
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((item, i) =>
                    i === index ? { ...item, pattern: e.target.value } : item,
                  ),
                )
              }
            />
            <select
              className="settings-select"
              value={draft.action}
              aria-label="Action"
              onChange={(e) =>
                setDrafts((prev) =>
                  prev.map((item, i) =>
                    i === index
                      ? { ...item, action: e.target.value as SiteRuleDraft['action'] }
                      : item,
                  ),
                )
              }
            >
              <option value="allow">allow</option>
              <option value="ask">ask</option>
              <option value="deny">deny</option>
            </select>
            <button
              type="button"
              className="settings-btn settings-btn-danger"
              aria-label="Remove rule"
              onClick={() => setDrafts((prev) => prev.filter((_, i) => i !== index))}
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <div className="settings-row">
        <button
          type="button"
          className="settings-btn"
          onClick={() =>
            setDrafts((prev) => [
              ...prev,
              { permission: 'click', pattern: 'https://github.com/*', action: 'deny' },
            ])
          }
        >
          Add rule
        </button>
        <button
          type="button"
          className="settings-btn settings-btn-primary"
          disabled={saving}
          onClick={() => void save()}
        >
          {saving ? 'Saving…' : 'Save rules'}
        </button>
      </div>

      <div className="settings-field">
        <label htmlFor="rule-preview-url">Match preview</label>
        <div className="settings-rule-preview">
          <select
            className="settings-select"
            value={previewTool}
            onChange={(e) => setPreviewTool(e.target.value)}
            aria-label="Preview tool"
          >
            {['click', 'type', 'navigate', 'page_read'].map((tool) => (
              <option key={tool} value={tool}>
                {tool}
              </option>
            ))}
          </select>
          <input
            id="rule-preview-url"
            className="settings-input"
            value={previewUrl}
            onChange={(e) => setPreviewUrl(e.target.value)}
          />
          <span className={`settings-preview-action settings-preview-${previewAction}`}>
            {previewAction}
          </span>
        </div>
      </div>
    </section>
  )
}
