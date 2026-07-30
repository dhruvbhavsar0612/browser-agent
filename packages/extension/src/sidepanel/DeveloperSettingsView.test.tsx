/**
 * @vitest-environment happy-dom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendRequest } from './client.js'
import { DeveloperSettingsView } from './DeveloperSettingsView.js'

vi.mock('./client.js', () => ({
  sendRequest: vi.fn(),
}))

const sendRequestMock = vi.mocked(sendRequest)

function configResponse(type: 'config.get' | 'config.set', developerMode: boolean) {
  return {
    type,
    payload: { settings: { developerMode } },
  } as never
}

describe('DeveloperSettingsView', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    sendRequestMock.mockReset()
  })

  afterEach(() => {
    root.unmount()
    document.body.innerHTML = ''
  })

  async function renderView() {
    await act(async () => {
      root.render(<DeveloperSettingsView hidden={false} />)
    })
  }

  it('loads the persisted developer mode value', async () => {
    sendRequestMock.mockResolvedValueOnce(configResponse('config.get', false))

    await renderView()

    const toggle = host.querySelector<HTMLInputElement>('#developer-mode-toggle')
    expect(toggle?.checked).toBe(false)
    expect(sendRequestMock).toHaveBeenCalledWith('config.get')
    expect(host.textContent).toContain('Chrome')
    expect(host.textContent).toContain('administrator')
  })

  it('persists developer mode changes through config.set', async () => {
    sendRequestMock
      .mockResolvedValueOnce(configResponse('config.get', false))
      .mockResolvedValueOnce(configResponse('config.set', true))

    await renderView()
    const toggle = host.querySelector<HTMLInputElement>('#developer-mode-toggle')

    await act(async () => {
      toggle?.click()
    })

    expect(sendRequestMock).toHaveBeenLastCalledWith('config.set', {
      settings: { developerMode: true },
    })
    expect(toggle?.checked).toBe(true)
  })
})
