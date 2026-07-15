import { beforeEach, describe, expect, it, vi } from 'vitest'
import { captureTabScreenshot, navigateTab } from './navigate-screenshot.js'

describe('navigate-screenshot bridge', () => {
  const listeners: Array<(tabId: number, info: chrome.tabs.TabChangeInfo) => void> = []

  beforeEach(() => {
    listeners.length = 0
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async (tabId: number) => ({
          id: tabId,
          title: 'Test',
          url: 'https://example.com',
          active: true,
          status: 'complete',
          windowId: 1,
        })),
        update: vi.fn(async (tabId: number, props: chrome.tabs.UpdateProperties) => ({
          id: tabId,
          title: 'Test',
          url: props.url ?? 'https://example.com',
          active: props.active ?? true,
          windowId: 1,
        })),
        captureVisibleTab: vi.fn(async (): Promise<string> => 'data:image/jpeg;base64,QUJD'),
        onUpdated: {
          addListener: vi.fn((listener: (tabId: number, info: chrome.tabs.TabChangeInfo) => void) => {
            listeners.push(listener)
          }),
          removeListener: vi.fn((listener: (tabId: number, info: chrome.tabs.TabChangeInfo) => void) => {
            const index = listeners.indexOf(listener)
            if (index >= 0) listeners.splice(index, 1)
          }),
        },
      },
    })
  })

  it('navigates a tab and waits for load completion', async () => {
    vi.mocked(chrome.tabs.get).mockImplementation(async (tabId) =>
      ({
        id: tabId,
        title: 'Test',
        url: 'https://example.com/new',
        active: true,
        status: 'loading',
        windowId: 1,
      }) as chrome.tabs.Tab,
    )

    const navigatePromise = navigateTab(5, 'https://example.com/new')

    await vi.waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    for (const listener of listeners) {
      listener(5, { status: 'complete' })
    }

    const tab = await navigatePromise
    expect(chrome.tabs.update).toHaveBeenCalledWith(5, { url: 'https://example.com/new' })
    expect(tab).toMatchObject({ id: 5, url: 'https://example.com/new' })
  })

  it('captures a JPEG screenshot via captureVisibleTab', async () => {
    const shot = await captureTabScreenshot(3)

    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(1, {
      format: 'jpeg',
      quality: 80,
    })
    expect(shot.mimeType).toBe('image/jpeg')
    expect(shot.dataBase64).toBe('QUJD')
    expect(shot.byteLength).toBeGreaterThan(0)
  })

  it('lowers JPEG quality when the screenshot exceeds the size cap', async () => {
    const largeBase64 = 'A'.repeat(1_400_000)
    const capture = chrome.tabs.captureVisibleTab as unknown as ReturnType<typeof vi.fn>
    capture
      .mockImplementationOnce(async () => `data:image/jpeg;base64,${largeBase64}`)
      .mockImplementationOnce(async () => 'data:image/jpeg;base64,QQ==')

    const shot = await captureTabScreenshot(3)

    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledTimes(2)
    expect(chrome.tabs.captureVisibleTab).toHaveBeenLastCalledWith(1, {
      format: 'jpeg',
      quality: 65,
    })
    expect(shot.byteLength).toBeLessThanOrEqual(1_024 * 1_024)
  })
})
