import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  createRequest,
  type AppConfigType,
  type ChatMessage,
  type PartRecord,
  type PermissionReply,
  type ProviderInfo,
  type SessionRecord,
  type StreamEvent,
} from '@browser-agent/core'
import { sendRequest } from './client.js'
import { MarkdownContent } from './markdown.js'
import { PermissionAskBanner, type PermissionAskRequest } from './PermissionAsk.js'
import { ThinkingDisclosure } from './ThinkingDisclosure.js'
import {
  ToolInspector,
  groupToolEvents,
  type ToolGroup,
  type ToolStreamEvent,
} from './ToolInspector.js'
import { ManagedStreamConnection } from './stream-connection.js'
import './Chat.css'

type ToolEvent = ToolStreamEvent

type UiMessage = ChatMessage & {
  id: string
  reasoning?: string
  tools?: ToolGroup[]
}

type TranscriptRow = {
  id: string
  role: string
  parts: PartRecord[]
}

function createId(): string {
  return crypto.randomUUID()
}

function titleFromPrompt(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'New chat'
  return cleaned.length > 48 ? `${cleaned.slice(0, 45)}…` : cleaned
}

function transcriptToMessages(rows: TranscriptRow[]): UiMessage[] {
  const messages: UiMessage[] = []

  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue

    let content = ''
    let reasoning = ''
    const toolEvents: ToolStreamEvent[] = []

    for (const part of row.parts) {
      if (part.type === 'text' && typeof part.content === 'string') {
        content += part.content
      } else if (part.type === 'reasoning' && typeof part.content === 'string') {
        reasoning += part.content
      } else if (part.type === 'tool-call') {
        const call = part.content as {
          toolCallId?: string
          toolName?: string
          args?: unknown
        }
        if (call.toolCallId && call.toolName) {
          toolEvents.push({
            kind: 'tool-call',
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            args: call.args,
          })
        }
      } else if (part.type === 'tool-result') {
        const result = part.content as { toolCallId?: string; result?: unknown }
        if (result.toolCallId) {
          toolEvents.push({
            kind: 'tool-result',
            toolCallId: result.toolCallId,
            result: result.result,
          })
        }
      }
    }

    messages.push({
      id: row.id,
      role: row.role,
      content,
      reasoning: reasoning || undefined,
      tools: toolEvents.length ? groupToolEvents(toolEvents) : undefined,
    })
  }

  return messages
}

export type ChatViewProps = {
  selectedAgent?: string
  sessionId: string | null
  onSessionChange: (session: SessionRecord | null) => void
  onSessionsRefresh: () => void
}

export function ChatView({
  selectedAgent,
  sessionId,
  onSessionChange,
  onSessionsRefresh,
}: ChatViewProps) {
  const agent = selectedAgent ?? 'browse'
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [loadingSession, setLoadingSession] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [permissionQueue, setPermissionQueue] = useState<PermissionAskRequest[]>([])
  const [permissionBusy, setPermissionBusy] = useState(false)
  const [config, setConfig] = useState<AppConfigType | null>(null)
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [session, setSession] = useState<SessionRecord | null>(null)
  const [selectedModel, setSelectedModel] = useState('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [connectionStatus, setConnectionStatus] = useState<
    'connected' | 'disconnected' | 'reconnecting'
  >('connected')

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<ManagedStreamConnection | null>(null)
  const activeRequestIdRef = useRef<string | null>(null)
  const streamingRef = useRef(false)
  const sessionIdRef = useRef(sessionId)

  const enabledModels = useMemo(() => {
    if (!config) return []
    return providers
      .filter((provider) => config.provider[provider.id]?.enabled)
      .map((provider) => ({
        provider,
        models: provider.models
          .filter((model) => config.provider[provider.id]?.models[model.id]?.enabled)
          .sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .filter(({ models }) => models.length > 0)
  }, [config, providers])

  const selectedModelEnabled = useMemo(
    () =>
      !selectedModel ||
      enabledModels.some(({ provider, models }) =>
        models.some((model) => `${provider.id}/${model.id}` === selectedModel),
      ),
    [enabledModels, selectedModel],
  )

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])

  useEffect(() => {
    sessionIdRef.current = sessionId
  }, [sessionId])

  useEffect(() => {
    let cancelled = false
    setLoadingModels(true)
    void Promise.all([
      sendRequest('config.get'),
      sendRequest('models.list'),
      sendRequest('session.list'),
    ])
      .then(([configResponse, modelsResponse, sessionsResponse]) => {
        if (cancelled) return
        if (configResponse.type === 'error' || modelsResponse.type === 'error') {
          throw new Error('Could not load enabled models')
        }
        const nextConfig = configResponse.payload as AppConfigType
        const nextProviders =
          (modelsResponse.payload as { providers?: ProviderInfo[] })?.providers ?? []
        const sessions = (sessionsResponse.payload ?? []) as SessionRecord[]
        const activeSession = sessionId
          ? (sessions.find((item) => item.id === sessionId) ?? null)
          : null
        setConfig(nextConfig)
        setProviders(nextProviders)
        setSession(activeSession)
        // New chats inherit only the global default. Existing chats retain
        // their pin; legacy unpinned sessions fall back at runtime.
        const agentModel = nextConfig.agent[agent]?.model
        const fallback = agentModel
          ? `${agentModel.providerID}/${agentModel.modelID}`
          : (nextConfig.model ?? '')
        setSelectedModel(activeSession?.model ?? (!sessionId ? (nextConfig.model ?? '') : fallback))
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false)
      })
    return () => {
      cancelled = true
    }
  }, [agent, sessionId])

  const appendToolEvent = useCallback((event: ToolEvent) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') {
        next.push({
          id: createId(),
          role: 'assistant',
          content: '',
          tools: groupToolEvents([event]),
        })
        return next
      }
      const rawEvents: ToolStreamEvent[] = []
      for (const group of last.tools ?? []) {
        if (group.args !== undefined) {
          rawEvents.push({
            kind: 'tool-call',
            toolCallId: group.toolCallId,
            toolName: group.toolName,
            args: group.args,
          })
        }
        if (group.result !== undefined) {
          rawEvents.push({
            kind: 'tool-result',
            toolCallId: group.toolCallId,
            result: group.result,
          })
        }
      }
      rawEvents.push(event)
      next[next.length - 1] = { ...last, tools: groupToolEvents(rawEvents) }
      return next
    })
  }, [])

  const handleStreamEvent = useCallback(
    (event: StreamEvent, envelopeId: string) => {
      const requestId = activeRequestIdRef.current
      if (!requestId || envelopeId !== requestId) return

      if (event.kind === 'text-delta') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (!last || last.role !== 'assistant') {
            next.push({ id: createId(), role: 'assistant', content: event.text })
            return next
          }
          next[next.length - 1] = { ...last, content: last.content + event.text }
          return next
        })
        return
      }

      if (event.kind === 'reasoning-delta') {
        setMessages((prev) => {
          const next = [...prev]
          const last = next[next.length - 1]
          if (!last || last.role !== 'assistant') {
            next.push({
              id: createId(),
              role: 'assistant',
              content: '',
              reasoning: event.text,
            })
            return next
          }
          next[next.length - 1] = {
            ...last,
            reasoning: (last.reasoning ?? '') + event.text,
          }
          return next
        })
        return
      }

      if (event.kind === 'tool-call' || event.kind === 'tool-result') {
        appendToolEvent(event)
        return
      }

      if (event.kind === 'permission-ask') {
        setPermissionQueue((prev) => {
          if (prev.some((item) => item.requestId === event.requestId)) return prev
          return [
            ...prev,
            {
              requestId: event.requestId,
              permission: event.permission,
              patterns: event.patterns,
              metadata: event.metadata,
            },
          ]
        })
        return
      }

      if (event.kind === 'error') {
        setError(event.message)
        setStreaming(false)
        activeRequestIdRef.current = null
        setPermissionQueue([])
        return
      }

      if (event.kind === 'done') {
        setStreaming(false)
        activeRequestIdRef.current = null
        setPermissionQueue([])
        onSessionsRefresh()
      }
    },
    [appendToolEvent, onSessionsRefresh],
  )

  useEffect(() => {
    const connection = new ManagedStreamConnection({
      onEvent: (event, envelope) => handleStreamEvent(event, envelope.id),
      onStatus: (status) => {
        setConnectionStatus(status)
        if (status === 'disconnected' && streamingRef.current) {
          setStreaming(false)
          activeRequestIdRef.current = null
          setError('Connection interrupted. Reconnecting… try sending again in a moment.')
        }
        if (status === 'connected') {
          setError((prev) =>
            prev?.startsWith('Connection interrupted') ||
            prev?.startsWith('Stream connection unavailable')
              ? null
              : prev,
          )
        }
      },
    })
    streamRef.current = connection
    return () => {
      connection.dispose()
      streamRef.current = null
    }
  }, [handleStreamEvent])

  useEffect(() => {
    let cancelled = false

    if (!sessionId) {
      setMessages([])
      setLoadingSession(false)
      setError(null)
      return
    }

    setLoadingSession(true)
    setError(null)

    void sendRequest('session.get', { id: sessionId })
      .then((response) => {
        if (cancelled) return
        if (response.type === 'error') {
          setError(
            typeof response.payload === 'object' &&
              response.payload &&
              'message' in response.payload
              ? String((response.payload as { message: string }).message)
              : 'Failed to load session',
          )
          setMessages([])
          return
        }
        const rows = (response.payload ?? []) as TranscriptRow[]
        setMessages(transcriptToMessages(rows))
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setMessages([])
      })
      .finally(() => {
        if (!cancelled) setLoadingSession(false)
      })

    return () => {
      cancelled = true
    }
  }, [sessionId])

  const ensureSession = useCallback(
    async (firstMessage: string): Promise<SessionRecord> => {
      const existingId = sessionIdRef.current
      if (existingId) {
        const listed = await sendRequest('session.list')
        const sessions = (listed.payload ?? []) as SessionRecord[]
        const found = sessions.find((item) => item.id === existingId)
        if (found) {
          setSession(found)
          return found
        }
      }

      const created = await sendRequest('session.create', {
        agent,
        title: titleFromPrompt(firstMessage),
        model: selectedModel || undefined,
      })
      if (created.type === 'error' || !created.payload) {
        throw new Error('Could not create chat session')
      }
      const session = created.payload as SessionRecord
      sessionIdRef.current = session.id
      setSession(session)
      setSelectedModel(session.model ?? '')
      onSessionChange(session)
      onSessionsRefresh()
      return session
    },
    [agent, onSessionChange, onSessionsRefresh, selectedModel],
  )

  const send = useCallback(() => {
    const text = input.trim()
    if (
      !text ||
      streaming ||
      loadingSession ||
      loadingModels ||
      !selectedModel ||
      !selectedModelEnabled
    )
      return

    const userMessage: UiMessage = { id: createId(), role: 'user', content: text }
    const assistantMessage: UiMessage = { id: createId(), role: 'assistant', content: '' }
    const history: ChatMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ]

    void (async () => {
      try {
        const stream = streamRef.current
        if (!stream) {
          setError('Stream connection unavailable. Reconnecting…')
          return
        }

        const session = await ensureSession(text)

        let tabId: number | undefined
        try {
          const [active] = await chrome.tabs.query({ active: true, currentWindow: true })
          tabId = active?.id
        } catch {
          tabId = undefined
        }

        const request = createRequest('agent.prompt', {
          messages: history,
          agent,
          sessionId: session.id,
          tabId,
        })
        activeRequestIdRef.current = request.id

        setMessages((prev) => [...prev, userMessage, assistantMessage])
        setInput('')
        setError(null)
        setStreaming(true)
        stream.postMessage(request)

        if (session.title === 'New session' || session.title === 'New chat') {
          void sendRequest('session.update', {
            id: session.id,
            title: titleFromPrompt(text),
          }).then(() => onSessionsRefresh())
        }
      } catch (err) {
        setStreaming(false)
        activeRequestIdRef.current = null
        setError(err instanceof Error ? err.message : String(err))
      }
    })()
  }, [
    agent,
    ensureSession,
    input,
    loadingSession,
    loadingModels,
    messages,
    onSessionsRefresh,
    selectedModel,
    selectedModelEnabled,
    streaming,
  ])

  const replyPermission = useCallback(
    async (response: PermissionReply) => {
      const current = permissionQueue[0]
      if (!current || permissionBusy) return
      setPermissionBusy(true)
      try {
        const result = await sendRequest('permission.reply', {
          id: current.requestId,
          response,
        })
        if (result.type === 'error') {
          setError(
            typeof result.payload === 'object' && result.payload && 'message' in result.payload
              ? String((result.payload as { message: string }).message)
              : 'Permission reply failed',
          )
        }
        setPermissionQueue((prev) => prev.filter((item) => item.requestId !== current.requestId))
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setPermissionBusy(false)
      }
    },
    [permissionBusy, permissionQueue],
  )

  const stop = useCallback(() => {
    const requestId = activeRequestIdRef.current
    if (!requestId) return
    void sendRequest('agent.stop', { id: requestId }).catch(() => undefined)
    setStreaming(false)
    activeRequestIdRef.current = null
    setPermissionQueue([])
  }, [])

  const switchModel = useCallback(
    async (model: string) => {
      if (!model || streaming) return
      setError(null)
      if (!sessionIdRef.current) {
        setSelectedModel(model)
        return
      }
      const response = await sendRequest('session.update', {
        id: sessionIdRef.current,
        model,
      })
      if (response.type === 'error' || !response.payload) {
        throw new Error('Could not update this chat model')
      }
      const updated = response.payload as SessionRecord
      setSession(updated)
      setSelectedModel(updated.model ?? model)
      onSessionChange(updated)
      onSessionsRefresh()
    },
    [onSessionChange, onSessionsRefresh, streaming],
  )

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="chat">
      <div className="chat-model-header">
        <label className="chat-model-picker">
          <span>Model</span>
          <select
            value={selectedModel}
            disabled={loadingModels || streaming || enabledModels.length === 0}
            onChange={(event) =>
              void switchModel(event.target.value).catch((err) =>
                setError(err instanceof Error ? err.message : String(err)),
              )
            }
          >
            {!selectedModel ? (
              <option value="">
                {loadingModels
                  ? 'Loading models…'
                  : enabledModels.length === 0
                    ? 'No enabled models'
                    : 'Choose a model'}
              </option>
            ) : null}
            {selectedModel && !selectedModelEnabled ? (
              <option value={selectedModel} disabled>
                {selectedModel} (disabled or disconnected)
              </option>
            ) : null}
            {enabledModels.map(({ provider, models }) => (
              <optgroup key={provider.id} label={provider.name}>
                {models.map((model) => (
                  <option key={`${provider.id}/${model.id}`} value={`${provider.id}/${model.id}`}>
                    {model.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <span className="chat-model-scope">
          {session?.model
            ? 'Pinned to this chat'
            : sessionId
              ? 'Using fallback'
              : 'New chat default'}
        </span>
      </div>
      {selectedModel && !selectedModelEnabled ? (
        <div className="chat-model-warning">
          This chat’s model is disabled, disconnected, or unavailable. Choose an enabled model.
        </div>
      ) : null}
      <div className="chat-messages" aria-live="polite">
        {loadingSession ? (
          <div className="chat-empty">
            <p>Loading chat…</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon" aria-hidden="true">
              ◎
            </div>
            <h2>What can I help with?</h2>
            <p>
              Connect and enable a provider in Settings, enable a model, then ask the agent to
              browse, read, or act on the current tab.
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isStreamingAssistant =
              streaming && index === messages.length - 1 && message.role === 'assistant'
            const hasReasoning = Boolean(message.reasoning)
            const showThinkingLive = isStreamingAssistant && hasReasoning && !message.content

            return (
              <div key={message.id} className={`chat-message chat-message-${message.role}`}>
                {message.role === 'assistant' && message.tools?.length ? (
                  <ToolInspector tools={message.tools} />
                ) : null}

                {message.role === 'assistant' && hasReasoning ? (
                  <ThinkingDisclosure content={message.reasoning ?? ''} isLive={showThinkingLive} />
                ) : null}

                {(message.content || message.role === 'user') && (
                  <div
                    className={`chat-bubble chat-bubble-${message.role}${
                      isStreamingAssistant && message.content ? ' chat-bubble-streaming' : ''
                    }`}
                  >
                    {message.role === 'assistant' ? (
                      message.content ? (
                        <MarkdownContent source={message.content} />
                      ) : isStreamingAssistant && !hasReasoning && !message.tools?.length ? (
                        '…'
                      ) : null
                    ) : (
                      message.content
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {connectionStatus !== 'connected' ? (
        <div className="chat-connection" role="status">
          {connectionStatus === 'reconnecting' ? 'Reconnecting…' : 'Connection lost — retrying'}
        </div>
      ) : null}

      {permissionQueue[0] ? (
        <PermissionAskBanner
          request={permissionQueue[0]}
          busy={permissionBusy}
          onReply={(response) => {
            void replyPermission(response)
          }}
        />
      ) : null}

      {error ? <div className="chat-error">{error}</div> : null}

      <div className="chat-composer">
        <div className="chat-composer-inner">
          <textarea
            className="chat-input"
            rows={2}
            placeholder="Message the agent…"
            value={input}
            disabled={streaming || loadingSession}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={onKeyDown}
          />
          <div className="chat-actions">
            {streaming ? (
              <button type="button" className="chat-btn chat-btn-stop" onClick={stop}>
                Stop
              </button>
            ) : (
              <button
                type="button"
                className="chat-btn chat-btn-send"
                disabled={
                  !input.trim() ||
                  loadingSession ||
                  loadingModels ||
                  !selectedModel ||
                  !selectedModelEnabled
                }
                onClick={send}
              >
                Send
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
