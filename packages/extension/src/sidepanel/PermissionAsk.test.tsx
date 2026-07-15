/**
 * @vitest-environment happy-dom
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PermissionAskBanner } from './PermissionAsk.js'

describe('PermissionAskBanner (DHR-62/67)', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('AC: renders once/always/reject for normal asks', async () => {
    const onReply = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        createElement(PermissionAskBanner, {
          request: {
            requestId: 'req-1',
            permission: 'click',
            patterns: ['https://example.com'],
          },
          onReply,
        }),
      )
    })

    expect(host.textContent).toMatch(/Allow .click./)
    expect(host.textContent).toContain('Once')
    expect(host.textContent).toContain('Always')
    expect(host.textContent).toContain('Reject')
    const buttons = host.querySelectorAll('button')
    expect(buttons.length).toBe(3)

    await act(async () => {
      ;(buttons[0] as HTMLButtonElement).click()
    })
    expect(onReply).toHaveBeenCalledWith('once')
    root.unmount()
  })

  it('AC: doom_loop labels continue/stop so user can break out', async () => {
    const onReply = vi.fn()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => {
      root.render(
        createElement(PermissionAskBanner, {
          request: {
            requestId: 'req-2',
            permission: 'doom_loop',
            patterns: ['*'],
            metadata: { toolName: 'echo', count: 3 },
          },
          onReply,
        }),
      )
    })

    expect(host.textContent).toContain('Agent appears stuck')
    expect(host.textContent).toContain('Continue once')
    expect(host.textContent).toContain('Stop')
    const reject = [...host.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Stop'),
    )

    await act(async () => {
      reject?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onReply).toHaveBeenCalledWith('reject')
    root.unmount()
  })
})
