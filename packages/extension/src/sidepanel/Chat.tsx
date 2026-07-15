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
import './Chat.css'

type ToolStatus = Extract<StreamEvent, { kind: 'tool-call' | 'tool-result' }>

type UiMessage = ChatMessage & {
  id: string
  tools?: ToolStatus[]
}

function createId(): string {
  return crypto.randomUUID()
}

function formatToolArgs(args: unknown): string {
  if (args == null) return ''
  if (typeof args === 'string') return args
  try {
    return JSON.stringify(args)
  } catch {
    return String(args)
  }
}

function formatToolResult(result: unknown): string {
  if (result == null) return ''
  if (typeof result === 'string') return result
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
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

  const appendToolEvent = useCallback((event: Extract<StreamEvent, { kind: 'tool-call' | 'tool-result' }>) => {
    setMessages((prev) => {
      const next = [...prev]
      const last = next[next.length - 1]
      if (!last || last.role !== 'assistant') {
        next.push({
          id: createId(),
          role: 'assistant',
          content: '',
          tools: [event],
        })
        return next
      }
      const tools = [...(last.tools ?? []), event]
      next[next.length - 1] = { ...last, tools }
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
            <h2>Start a conversation</h2>
            <p>
              Add an API key in Settings, select a default model, then send a message to stream a
              reply here.
            </p>
          </div>
        ) : (
          messages.map((message, index) => {
            const isStreamingAssistant =
              streaming && index === messages.length - 1 && message.role === 'assistant'
            return (
              <div
                key={message.id}
                className={`chat-bubble chat-bubble-${message.role}${
                  isStreamingAssistant ? ' chat-bubble-streaming' : ''
                }`}
              >
                {message.tools?.map((tool) =>
                  tool.kind === 'tool-call' ? (
                    <div key={tool.toolCallId} className="chat-tool chat-tool-call">
                      Calling <span className="chat-tool-name">{tool.toolName}</span>
                      {formatToolArgs(tool.args) ? (
                        <span className="chat-tool-detail"> {formatToolArgs(tool.args)}</span>
                      ) : null}
                    </div>
                  ) : (
                    <div key={`${tool.toolCallId}-result`} className="chat-tool chat-tool-result">
                      Result: <span className="chat-tool-detail">{formatToolResult(tool.result)}</span>
                    </div>
                  ),
                )}
                {message.content || (isStreamingAssistant ? '' : message.tools?.length ? '' : '…')}
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {error ? <div className="chat-error">{error}</div> : null}

      <div className="chat-composer">
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
  )
}
