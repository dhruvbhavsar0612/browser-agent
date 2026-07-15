import { beforeEach, describe, expect, it, vi } from 'vitest'

type DebuggerListener = (
  source: chrome.debugger.Debuggee,
  method: string,
  params?: object,
) => void

type DetachListener = (source: chrome.debugger.Debuggee, reason: string) => void

describe('CDP debugger', () => {
  let onEventListeners: DebuggerListener[]
  let onDetachListeners: DetachListener[]
  let attachImpl: ReturnType<typeof vi.fn>
  let detachImpl: ReturnType<typeof vi.fn>
  let sendCommandImpl: ReturnType<typeof vi.fn>
  let tabRemovedListener: ((tabId: number) => void) | undefined

  beforeEach(() => {
    vi.resetModules()
    onEventListeners = []
    onDetachListeners = []

    attachImpl = vi.fn((_target, _version, cb) => cb?.())
    detachImpl = vi.fn((_target, cb) => cb?.())
    sendCommandImpl = vi.fn((_target, _method, _params, cb) => cb?.({ ok: true }))

    vi.stubGlobal('chrome', {
      runtime: { lastError: undefined },
      tabs: {
        onRemoved: {
          addListener: vi.fn((listener: (tabId: number) => void) => {
            tabRemovedListener = listener
          }),
        },
      },
      debugger: {
        attach: attachImpl,
        detach: detachImpl,
        sendCommand: sendCommandImpl,
        onEvent: {
          addListener: vi.fn((listener: DebuggerListener) => {
            onEventListeners.push(listener)
          }),
        },
        onDetach: {
          addListener: vi.fn((listener: DetachListener) => {
            onDetachListeners.push(listener)
          }),
        },
      },
    })
  })

  async function loadDebugger() {
    return import('./debugger.js')
  }

  it('attaches once per tab and tracks session state', async () => {
    const dbg = await loadDebugger()

    await dbg.attach(7)
    await dbg.attach(7)

    expect(attachImpl).toHaveBeenCalledTimes(1)
    expect(dbg.isDebuggerAttached(7)).toBe(true)
    expect(dbg.getAttachedTabIds()).toEqual([7])
  })

  it('sendCommand auto-attaches and forwards CDP calls', async () => {
    const dbg = await loadDebugger()

    const result = await dbg.sendCommand(3, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 2 })

    expect(attachImpl).toHaveBeenCalledWith({ tabId: 3 }, '1.3', expect.any(Function))
    expect(sendCommandImpl).toHaveBeenCalledWith(
      { tabId: 3 },
      'Input.dispatchMouseEvent',
      { type: 'mouseMoved', x: 1, y: 2 },
      expect.any(Function),
    )
    expect(result).toEqual({ ok: true })
  })

  it('detaches and clears session map', async () => {
    const dbg = await loadDebugger()

    await dbg.attach(9)
    await dbg.detach(9)

    expect(detachImpl).toHaveBeenCalledWith({ tabId: 9 }, expect.any(Function))
    expect(dbg.isDebuggerAttached(9)).toBe(false)
  })

  it('detachAll clears every attached tab', async () => {
    const dbg = await loadDebugger()

    await dbg.attach(1)
    await dbg.attach(2)
    await dbg.detachAll()

    expect(detachImpl).toHaveBeenCalledTimes(2)
    expect(dbg.getAttachedTabIds()).toEqual([])
  })

  it('cleans up when chrome.debugger.onDetach fires', async () => {
    const dbg = await loadDebugger()

    await dbg.attach(4)
    expect(onDetachListeners.length).toBeGreaterThan(0)
    onDetachListeners[0]?.({ tabId: 4 }, 'canceled_by_user')

    expect(dbg.isDebuggerAttached(4)).toBe(false)
  })

  it('cleans up when tab is removed', async () => {
    const dbg = await loadDebugger()

    await dbg.attach(11)
    expect(tabRemovedListener).toBeDefined()
    tabRemovedListener?.(11)

    expect(dbg.isDebuggerAttached(11)).toBe(false)
  })

  it('rejects attach when chrome reports an error', async () => {
  const dbg = await loadDebugger()

    attachImpl.mockImplementation((_target, _version, cb) => {
      chrome.runtime.lastError = { message: 'Cannot access a chrome:// URL' }
      cb?.()
      chrome.runtime.lastError = undefined
    })

    await expect(dbg.attach(99)).rejects.toThrow('Cannot access a chrome:// URL')
    expect(dbg.isDebuggerAttached(99)).toBe(false)
  })
})
