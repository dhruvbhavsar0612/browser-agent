/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

describe('visual-indicator content script (DHR-68)', () => {
  beforeEach(() => {
    document.head.innerHTML = ''
    document.body.innerHTML = ''
    delete (window as Window & { __baIndicatorInstalled?: boolean }).__baIndicatorInstalled
    vi.resetModules()

    const listeners: Array<(msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void> =
      []
    vi.stubGlobal('chrome', {
      runtime: {
        onMessage: {
          addListener: (
            fn: (msg: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean | void,
          ) => {
            listeners.push(fn)
          },
        },
      },
    })
    ;(globalThis as unknown as { __baListeners?: typeof listeners }).__baListeners = listeners
  })

  it('AC: indicator visible while agent active; removed when hidden', async () => {
    await import('./visual-indicator.js')
    const listeners = (globalThis as unknown as { __baListeners: Array<Function> }).__baListeners
    expect(listeners.length).toBeGreaterThan(0)

    const showResp = await new Promise<Record<string, unknown>>((resolve) => {
      listeners[0]!({ type: 'ba.indicator.show' }, {}, resolve)
    })
    expect(showResp.visible).toBe(true)
    expect(document.getElementById('ba-agent-indicator-root')).toBeTruthy()
    expect(document.body.textContent).toContain('Agent active')

    const hideResp = await new Promise<Record<string, unknown>>((resolve) => {
      listeners[0]!({ type: 'ba.indicator.hide' }, {}, resolve)
    })
    expect(hideResp.visible).toBe(false)
    expect(document.getElementById('ba-agent-indicator-root')).toBeNull()
  })
})
