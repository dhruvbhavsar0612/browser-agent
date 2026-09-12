/**
 * @vitest-environment happy-dom
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS_VIEW,
  SettingsShell,
  viewFromSettingsHash,
  type SettingsViewId,
} from './SettingsShell.js'

describe('SettingsShell', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(() => {
    window.history.replaceState(null, '', '/')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(() => {
    root.unmount()
    document.body.innerHTML = ''
    window.history.replaceState(null, '', '/')
  })

  async function renderShell() {
    await act(async () => {
      root.render(
        <SettingsShell>
          {(activeView: SettingsViewId) => <p data-testid="active-view">{activeView}</p>}
        </SettingsShell>,
      )
    })
  }

  it('defaults a fresh Settings page to Connectors', async () => {
    await renderShell()

    expect(DEFAULT_SETTINGS_VIEW).toBe('connectors')
    expect(host.querySelector('[data-testid="active-view"]')?.textContent).toBe('connectors')
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Connectors')
  })

  it('uses a valid hash when opening a deep-linked view', async () => {
    window.location.hash = 'developer'
    await renderShell()

    expect(host.querySelector('[data-testid="active-view"]')?.textContent).toBe('developer')
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Developer')
  })

  it('switches the main pane and updates the hash from navigation', async () => {
    await renderShell()
    const providersButton = [...host.querySelectorAll('button')].find(
      (button) => button.textContent === 'Providers',
    )

    await act(async () => {
      providersButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(window.location.hash).toBe('#providers')
    expect(host.querySelector('[data-testid="active-view"]')?.textContent).toBe('providers')
  })

  it('responds to browser hash navigation', async () => {
    await renderShell()

    await act(async () => {
      window.location.hash = 'agent'
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(host.querySelector('[data-testid="active-view"]')?.textContent).toBe('agent')
  })

  it('ignores unknown hash fragments', () => {
    expect(viewFromSettingsHash('#connectors')).toBe('connectors')
    expect(viewFromSettingsHash('#developer')).toBe('developer')
    expect(viewFromSettingsHash('#not-a-settings-view')).toBeNull()
  })
})
