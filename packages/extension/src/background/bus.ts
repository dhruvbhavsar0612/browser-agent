import {
  PORT_NAMES,
  createErrorResponse,
  createResponse,
  createStreamEnvelope,
  parseEnvelope,
  parseStreamEvent,
  type Envelope,
  type MessageType,
  type StreamEvent,
} from '@browser-agent/core'

export type MessageHandler = (
  message: Envelope,
  sender: chrome.runtime.MessageSender,
) => Promise<Envelope> | Envelope

export type PortHandler = (message: Envelope, port: chrome.runtime.Port) => Promise<void> | void

const KEEPALIVE_ALARM = 'browser-agent.keepalive'
const KEEPALIVE_PERIOD_MINUTES = 1

let keepaliveRefs = 0

/** Keep the service worker alive while an agent run (or demo stream) is active. */
export function startKeepalive(): void {
  keepaliveRefs += 1
  if (keepaliveRefs === 1) {
    void chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: KEEPALIVE_PERIOD_MINUTES })
  }
}

export function stopKeepalive(): void {
  if (keepaliveRefs === 0) return
  keepaliveRefs -= 1
  if (keepaliveRefs === 0) {
    void chrome.alarms.clear(KEEPALIVE_ALARM)
  }
}

export function isKeepaliveActive(): boolean {
  return keepaliveRefs > 0
}

/** Test/reset helper — not for production paths. */
export function resetKeepaliveForTests(): void {
  keepaliveRefs = 0
}

export class MessageBus {
  private readonly handlers = new Map<string, MessageHandler>()
  private readonly portHandlers = new Map<string, PortHandler>()
  private readonly streamPorts = new Set<chrome.runtime.Port>()
  private listening = false

  on(type: MessageType, handler: MessageHandler): this {
    this.handlers.set(type, handler)
    return this
  }

  onPort(type: MessageType, handler: PortHandler): this {
    this.portHandlers.set(type, handler)
    return this
  }

  async dispatch(raw: unknown, sender: chrome.runtime.MessageSender): Promise<Envelope> {
    const parsed = parseEnvelope(raw)
    const handler = this.handlers.get(parsed.type)
    if (!handler) {
      return createErrorResponse(parsed, `Unhandled message type: ${parsed.type}`)
    }
    return handler(parsed, sender)
  }

  /** Push a stream event to one port (or all connected stream ports). */
  pushStreamEvent(event: StreamEvent, opts?: { port?: chrome.runtime.Port; id?: string; seq?: number }): void {
    const envelope = createStreamEnvelope(event, { id: opts?.id, seq: opts?.seq })
    if (opts?.port) {
      opts.port.postMessage(envelope)
      return
    }
    for (const port of this.streamPorts) {
      try {
        port.postMessage(envelope)
      } catch {
        this.streamPorts.delete(port)
      }
    }
  }

  /** Emit events in order on a single port; starts/stops keepalive around the run. */
  async emitStreamInOrder(
    port: chrome.runtime.Port,
    events: StreamEvent[],
    opts?: { id?: string; delayMs?: number },
  ): Promise<void> {
    startKeepalive()
    try {
      let seq = 0
      for (const event of events) {
        this.pushStreamEvent(event, { port, id: opts?.id, seq })
        seq += 1
        if (opts?.delayMs && opts.delayMs > 0) {
          await delay(opts.delayMs)
        }
      }
    } finally {
      stopKeepalive()
    }
  }

  listen(): void {
    if (this.listening) return
    this.listening = true

    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
      void this.dispatch(message, sender)
        .then(sendResponse)
        .catch((err: unknown) => {
          const id =
            message && typeof message === 'object' && 'id' in message && typeof message.id === 'string'
              ? message.id
              : crypto.randomUUID()
          sendResponse(createErrorResponse({ id }, err instanceof Error ? err.message : String(err)))
        })
      return true
    })

    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== PORT_NAMES.STREAM) return
      this.streamPorts.add(port)
      port.onDisconnect.addListener(() => {
        this.streamPorts.delete(port)
      })
      port.onMessage.addListener((raw) => {
        void this.handlePortMessage(raw, port)
      })
    })

    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === KEEPALIVE_ALARM) {
        // Intentional no-op: alarm wake keeps the SW alive during agent runs.
      }
    })
  }

  private async handlePortMessage(raw: unknown, port: chrome.runtime.Port): Promise<void> {
    let message: Envelope
    try {
      message = parseEnvelope(raw)
    } catch (err) {
      port.postMessage(
        createErrorResponse(
          { id: crypto.randomUUID() },
          err instanceof Error ? err.message : 'Invalid port message',
        ),
      )
      return
    }

    const handler = this.portHandlers.get(message.type)
    if (!handler) {
      // Allow stream.event payloads to be ignored if echoed; otherwise error.
      if (message.type === 'stream.event') {
        parseStreamEvent(message.payload)
        return
      }
      port.postMessage(createErrorResponse(message, `Unhandled port message type: ${message.type}`))
      return
    }

    try {
      await handler(message, port)
    } catch (err) {
      port.postMessage(
        createErrorResponse(message, err instanceof Error ? err.message : String(err)),
      )
    }
  }
}

export function createMessageBus(): MessageBus {
  return new MessageBus()
}

/** Demo stream used to prove ordered port delivery (not a real LLM run). */
export async function runDemoStream(bus: MessageBus, port: chrome.runtime.Port, request: Envelope): Promise<void> {
  const events: StreamEvent[] = [
    { kind: 'text-delta', text: 'Hello' },
    { kind: 'text-delta', text: ' from' },
    { kind: 'text-delta', text: ' the message bus.' },
    { kind: 'done' },
  ]
  await bus.emitStreamInOrder(port, events, { id: request.id, delayMs: 10 })
  port.postMessage(createResponse(request, 'stream.demo', { ok: true, events: events.length }))
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
