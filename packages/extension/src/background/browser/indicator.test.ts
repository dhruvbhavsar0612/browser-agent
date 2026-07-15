import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hideAllAgentIndicators,
  hideAgentIndicator,
  resetIndicatorsForTests,
  showAgentIndicator,
  getIndicatedTabIds,
} from './indicator.js'

describe('agent indicator messaging (DHR-68)', () => {
  beforeEach(() => {
    resetIndicatorsForTests()
    vi.stubGlobal('chrome', {
      tabs: {
        sendMessage: vi.fn(async () => ({ ok: true })),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows indicator and tracks tab id', async () => {
    await showAgentIndicator(42)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(42, { type: 'ba.indicator.show' })
    expect(getIndicatedTabIds()).toEqual([42])
  })

  it('hides indicator and clears tracking', async () => {
    await showAgentIndicator(7)
    await hideAgentIndicator(7)
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(7, { type: 'ba.indicator.hide' })
    expect(getIndicatedTabIds()).toEqual([])
  })

  it('hideAll clears every indicated tab', async () => {
    await showAgentIndicator(1)
    await showAgentIndicator(2)
    await hideAllAgentIndicators()
    expect(getIndicatedTabIds()).toEqual([])
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(1, { type: 'ba.indicator.hide' })
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(2, { type: 'ba.indicator.hide' })
  })

  it('tolerates missing content script on show', async () => {
    vi.mocked(chrome.tabs.sendMessage).mockRejectedValueOnce(new Error('Receiving end does not exist'))
    await expect(showAgentIndicator(9)).resolves.toBeUndefined()
    expect(getIndicatedTabIds()).toEqual([])
  })
})
