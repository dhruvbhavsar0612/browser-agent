import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagedStreamConnection } from './stream-connection.js'

type PortListener = (raw: unknown) => void
type VoidListener = () => void

function createFakePort() {
  const messageListeners: PortListener[] = []
  const disconnectListeners: VoidListener[] = []
  let disconnected = false

  const port = {
    name: 'browser-agent.stream',
    postMessage: vi.fn((message: unknown) => {
      if (disconnected) throw new Error('Attempting to use a disconnected port object')
      return message
    }),
    disconnect: vi.fn(() => {
      disconnected = true
      for (const listener of disconnectListeners) listener()
    }),
    onMessage: {
      addListener: (listener: PortListener) => {
        messageListeners.push(listener)
      },
      removeListener: (listener: PortListener) => {
        const index = messageListeners.indexOf(listener)
        if (index >= 0) messageListeners.splice(index, 1)
      },
    },
    onDisconnect: {
      addListener: (listener: VoidListener) => {
        disconnectListeners.push(listener)
      },
      removeListener: (listener: VoidListener) => {
        const index = disconnectListeners.indexOf(listener)
        if (index >= 0) disconnectListeners.splice(index, 1)
      },
    },
    emitMessage(raw: unknown) {
      for (const listener of messageListeners) listener(raw)
    },
    simulateDisconnect() {
      disconnected = true
      for (const listener of [...disconnectListeners]) listener()
    },
  }

  return port
}

describe('ManagedStreamConnection', () => {
  const ports: ReturnType<typeof createFakePort>[] = []

  beforeEach(() => {
    ports.length = 0
    vi.useFakeTimers()
    vi.stubGlobal('chrome', {
      runtime: {
        connect: vi.fn(() => {
          const port = createFakePort()
          ports.push(port)
          return port
        }),
        sendMessage: vi.fn((_message: unknown, callback?: () => void) => {
          callback?.()
        }),
        lastError: undefined,
      },
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reconnects after disconnect and can post again', () => {
    const statuses: string[] = []
    const connection = new ManagedStreamConnection({
      onEvent: () => undefined,
      onStatus: (status) => statuses.push(status),
    })

    expect(ports).toHaveLength(1)
    ports[0]!.simulateDisconnect()
    expect(statuses).toContain('disconnected')

    vi.advanceTimersByTime(200)
    expect(ports.length).toBeGreaterThanOrEqual(2)

    connection.postMessage({ id: '1', type: 'ping' })
    expect(ports.at(-1)!.postMessage).toHaveBeenCalled()

    connection.dispose()
  })

  it('ensurePort reconnects immediately when port is null', () => {
    const connection = new ManagedStreamConnection({
      onEvent: () => undefined,
    })
    ports[0]!.simulateDisconnect()
    // Clear scheduled reconnect and force ensurePort path
    const port = connection.ensurePort()
    expect(port).toBeTruthy()
    expect(ports.length).toBeGreaterThanOrEqual(2)
    connection.dispose()
  })
})
