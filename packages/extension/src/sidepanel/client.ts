import {
  PORT_NAMES,
  createRequest,
  parseEnvelope,
  parseStreamEvent,
  type Envelope,
  type MessageType,
  type StreamEvent,
} from '@browser-agent/core'

/**
 * One-shot request/response over chrome.runtime.sendMessage.
 * Correlation id is preserved on the response envelope.
 */
export function sendRequest(type: MessageType, payload?: unknown): Promise<Envelope> {
  const request = createRequest(type, payload)
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(request, (response: unknown) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message))
          return
        }
        try {
          resolve(parseEnvelope(response))
        } catch (err) {
          reject(err instanceof Error ? err : new Error(String(err)))
        }
      })
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export type StreamClient = {
  /** Post a typed message on the stream port (e.g. stream.demo). */
  post(type: MessageType, payload?: unknown): void
  disconnect(): void
}

/**
 * Long-lived Port connection for ordered StreamEvent delivery.
 * Call `post('stream.demo')` to exercise the infra demo stream.
 */
export function connectStream(
  onEvent: (event: StreamEvent, envelope: Envelope) => void,
  opts?: {
    onMessage?: (envelope: Envelope) => void
    onDisconnect?: () => void
  },
): StreamClient {
  const port = chrome.runtime.connect({ name: PORT_NAMES.STREAM })

  port.onMessage.addListener((raw) => {
    let envelope: Envelope
    try {
      envelope = parseEnvelope(raw)
    } catch {
      return
    }

    opts?.onMessage?.(envelope)

    if (envelope.type === 'stream.event') {
      try {
        onEvent(parseStreamEvent(envelope.payload), envelope)
      } catch {
        // ignore malformed stream payloads
      }
    }
  })

  port.onDisconnect.addListener(() => {
    opts?.onDisconnect?.()
  })

  return {
    post(type, payload) {
      port.postMessage(createRequest(type, payload))
    },
    disconnect() {
      port.disconnect()
    },
  }
}
