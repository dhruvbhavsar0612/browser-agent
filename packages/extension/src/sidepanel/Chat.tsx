import { useCallback, useEffect, useRef, useState } from 'react'
import {
  PORT_NAMES,
  createRequest,
  parseEnvelope,
  parseStreamEvent,
  type ChatMessage,
  type Envelope,
} from '@browser-agent/core'
import { sendRequest } from './client.js'
import './Chat.css'

type UiMessage = ChatMessage & { id: string }

function createId(): string {
  return crypto.randomUUID()
}

export function ChatView() {
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
  }, [])

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

    const request = createRequest('agent.prompt', { messages: history, agent: 'browse' })
    activeRequestIdRef.current = request.id

    setMessages((prev) => [...prev, userMessage, assistantMessage])
    setInput('')
    setError(null)
    setStreaming(true)
    port.postMessage(request)
  }, [input, messages, streaming])

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
                {message.content || (isStreamingAssistant ? '' : '…')}
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
