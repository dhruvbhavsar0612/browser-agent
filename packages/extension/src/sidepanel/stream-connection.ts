import {
  PORT_NAMES,
  parseEnvelope,
  parseStreamEvent,
  type Envelope,
  type StreamEvent,
} from '@browser-agent/core'

const HEARTBEAT_MS = 20_000
const RECONNECT_BASE_MS = 150
const RECONNECT_MAX_MS = 4_000

export type StreamConnectionHandlers = {
  onEvent: (event: StreamEvent, envelope: Envelope) => void
  onEnvelope?: (envelope: Envelope) => void
  onStatus?: (status: 'connected' | 'disconnected' | 'reconnecting') => void
}

/**
 * Long-lived stream port that survives MV3 service-worker restarts.
 * Chrome kills idle workers; without reconnect the side panel stays stuck
 * with a null port until reload.
 */
export class ManagedStreamConnection {
  private port: chrome.runtime.Port | null = null
  private disposed = false
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private readonly handlers: StreamConnectionHandlers

  constructor(handlers: StreamConnectionHandlers) {
    this.handlers = handlers
    this.connect()
    this.startHeartbeat()
  }

  /** Ensure a live port; reconnects synchronously if needed. */
  ensurePort(): chrome.runtime.Port {
    if (this.disposed) {
      throw new Error('Stream connection was disposed')
    }
    if (this.port) return this.port
    const port = this.connect()
    if (!port) {
      throw new Error('Stream connection unavailable')
    }
    return port
  }

  postMessage(message: unknown): void {
    const port = this.ensurePort()
    try {
      port.postMessage(message)
    } catch {
      this.port = null
      this.handlers.onStatus?.('disconnected')
      const reconnected = this.connect()
      if (!reconnected) throw new Error('Stream connection unavailable')
      reconnected.postMessage(message)
    }
  }

  dispose(): void {
    this.disposed = true
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    const port = this.port
    this.port = null
    try {
      port?.disconnect()
    } catch {
      // already disconnected
    }
  }

  private connect(): chrome.runtime.Port | null {
    if (this.disposed) return null

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    try {
      const port = chrome.runtime.connect({ name: PORT_NAMES.STREAM })
      this.port = port
      this.reconnectAttempt = 0
      this.handlers.onStatus?.('connected')

      port.onMessage.addListener((raw) => {
        let envelope: Envelope
        try {
          envelope = parseEnvelope(raw)
        } catch {
          return
        }

        this.handlers.onEnvelope?.(envelope)

        if (envelope.type === 'stream.event') {
          try {
            this.handlers.onEvent(parseStreamEvent(envelope.payload), envelope)
          } catch {
            // ignore malformed stream payloads
          }
        }
      })

      port.onDisconnect.addListener(() => {
        if (this.port === port) {
          this.port = null
        }
        if (this.disposed) return
        this.handlers.onStatus?.('disconnected')
        this.scheduleReconnect()
      })

      return port
    } catch {
      this.port = null
      this.handlers.onStatus?.('disconnected')
      this.scheduleReconnect()
      return null
    }
  }

  private scheduleReconnect(): void {
    if (this.disposed || this.reconnectTimer || this.port) return

    this.handlers.onStatus?.('reconnecting')
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.reconnectAttempt,
      RECONNECT_MAX_MS,
    )
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, delay)
  }

  /** Wake the service worker periodically so idle death is less likely. */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.disposed) return
      try {
        chrome.runtime.sendMessage({ id: crypto.randomUUID(), type: 'ping' }, () => {
          void chrome.runtime.lastError
          if (!this.port && !this.disposed) {
            this.connect()
          }
        })
      } catch {
        if (!this.port && !this.disposed) {
          this.scheduleReconnect()
        }
      }
    }, HEARTBEAT_MS)
  }
}
