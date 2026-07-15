import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PORT_NAMES,
  createRequest,
  parseEnvelope,
  parseStreamEvent,
  type ChatMessage,
  type Envelope,
  type StreamEvent,
} from '@browser-agent/core'
import { sendRequest } from './client.js'
import { MarkdownContent } from './markdown.js'
import { ThinkingDisclosure } from './ThinkingDisclosure.js'
import { ToolInspector, groupToolEvents, type ToolGroup, type ToolStreamEvent } from './ToolInspector.js'
import './Chat.css'

type ToolEvent = ToolStreamEvent

type UiMessage = ChatMessage & {
  id: string
  reasoning?: string
  tools?: ToolGroup[]
}

function createId(): string {
  return crypto.randomUUID()
}

export function ChatView({ selectedAgent }: { selectedAgent?: string }) {
  const agent = selectedAgent ?? 'browse'
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const activeRequestIdRef = useRef<string | null>(null)
  const streamingRef = useRef(false)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  useEffect(() => {
    streamingRef.current = streaming
  }, [streaming])

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

  useEffect(() => {
    const port = chrome.runtime.connect({ name: PORT_NAMES.STREAM })
    portRef.current = port

    const onMessage = (raw: unknown) => {
      let envelope: Envelope
      try {
        envelope = parseEnvelope(raw)
      } catch {
        return
      }

      if (envelope.type !== 'stream.event') {
        return
      }

      const requestId = activeRequestIdRef.current
      if (!requestId || envelope.id !== requestId) {
        return
      }

      let event
      try {
        event = parseStreamEvent(envelope.payload)
      } catch {
        return
      }

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

      if (event.kind === 'error') {
        setError(event.message)
        setStreaming(false)
        activeRequestIdRef.current = null
        return
      }

      if (event.kind === 'done') {
        setStreaming(false)
        activeRequestIdRef.current = null
      }
    }

    port.onMessage.addListener(onMessage)
    port.onDisconnect.addListener(() => {
      portRef.current = null
      if (streamingRef.current) {
        setStreaming(false)
        activeRequestIdRef.current = null
      }
    })

    return () => {
      port.onMessage.removeListener(onMessage)
      port.disconnect()
      portRef.current = null
    }
  }, [appendToolEvent])

  const send = useCallback(() => {
    const text = input.trim()
    if (!text || streaming) return

    const port = portRef.current
    if (!port) {
      setError('Stream connection unavailable. Reload the side panel.')
      return
    }

    const userMessage: UiMessage = { id: createId(), role: 'user', content: text }
    const assistantMessage: UiMessage = { id: createId(), role: 'assistant', content: '' }
    const history: ChatMessage[] = [
      ...messages.map(({ role, content }) => ({ role, content })),
      { role: 'user', content: text },
    ]

    void (async () => {
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
        tabId,
      })
      activeRequestIdRef.current = request.id

      setMessages((prev) => [...prev, userMessage, assistantMessage])
      setInput('')
      setError(null)
      setStreaming(true)
      port.postMessage(request)
    })()
  }, [agent, input, messages, streaming])

  const stop = useCallback(() => {
    const requestId = activeRequestIdRef.current
    if (!requestId) return
    void sendRequest('agent.stop', { id: requestId }).catch(() => undefined)
    setStreaming(false)
    activeRequestIdRef.current = null
  }, [])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  return (
    <div className="chat">
      <div className="chat-messages" aria-live="polite">
        {messages.length === 0 ? (
          <div className="chat-empty">
            <div className="chat-empty-icon" aria-hidden="true">
              ◎
            </div>
            <h2>What can I help with?</h2>
            <p>
              Configure an API key in Settings, pick a model, then ask the agent to browse, read, or
              act on the current tab.
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isStreamingAssistant =
              streaming && index === messages.length - 1 && message.role === 'assistant'
            const hasReasoning = Boolean(message.reasoning)
            const showThinkingLive = isStreamingAssistant && hasReasoning && !message.content

            return (
              <div
                key={message.id}
                className={`chat-message chat-message-${message.role}`}
              >
                {message.role === 'assistant' && message.tools?.length ? (
                  <ToolInspector tools={message.tools} />
                ) : null}

                {message.role === 'assistant' && hasReasoning ? (
                  <ThinkingDisclosure
                    content={message.reasoning ?? ''}
                    isLive={showThinkingLive}
                  />
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

      {error ? <div className="chat-error">{error}</div> : null}

      <div className="chat-composer">
        <div className="chat-composer-inner">
          <textarea
            className="chat-input"
            rows={2}
            placeholder="Message the agent…"
            value={input}
            disabled={streaming}
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
                disabled={!input.trim()}
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
