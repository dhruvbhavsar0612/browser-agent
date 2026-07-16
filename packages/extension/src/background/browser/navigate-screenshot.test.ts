import { beforeEach, describe, expect, it, vi } from 'vitest'

const sendCommand = vi.fn()

vi.mock('./debugger.js', () => ({
  sendCommand: (...args: unknown[]) => sendCommand(...args),
}))

describe('navigate-screenshot bridge', () => {
  const listeners: Array<(tabId: number, info: chrome.tabs.TabChangeInfo) => void> = []

  beforeEach(async () => {
    listeners.length = 0
    sendCommand.mockReset()
    sendCommand.mockResolvedValue({ data: 'QUJD' })
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
          active: props.active ?? false,
          windowId: 1,
        })),
        captureVisibleTab: vi.fn(async (): Promise<string> => 'data:image/jpeg;base64,QUJD'),
        onUpdated: {
          addListener: vi.fn((listener: (tabId: number, info: chrome.tabs.TabChangeInfo) => void) => {
            listeners.push(listener)
          }),
          removeListener: vi.fn(
            (listener: (tabId: number, info: chrome.tabs.TabChangeInfo) => void) => {
              const index = listeners.indexOf(listener)
              if (index >= 0) listeners.splice(index, 1)
            },
          ),
        },
      },
    })
  })

  it('navigates a tab and waits for load completion', async () => {
    const { navigateTab } = await import('./navigate-screenshot.js')
    vi.mocked(chrome.tabs.get).mockImplementation(
      async (tabId) =>
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

  it('captures via CDP Page.captureScreenshot first', async () => {
    const { captureTabScreenshot } = await import('./navigate-screenshot.js')
    const shot = await captureTabScreenshot(3)

    expect(sendCommand).toHaveBeenCalledWith(3, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 80,
      fromSurface: true,
    })
    expect(chrome.tabs.captureVisibleTab).not.toHaveBeenCalled()
    expect(shot.mimeType).toBe('image/jpeg')
    expect(shot.dataBase64).toBe('QUJD')
    expect(shot.byteLength).toBeGreaterThan(0)
  })

  it('falls back to captureVisibleTab when CDP fails', async () => {
    sendCommand.mockRejectedValueOnce(new Error('debugger attach failed'))
    const { captureTabScreenshot } = await import('./navigate-screenshot.js')
    const shot = await captureTabScreenshot(3)

    expect(chrome.tabs.captureVisibleTab).toHaveBeenCalledWith(1, {
      format: 'jpeg',
      quality: 80,
    })
    expect(shot.dataBase64).toBe('QUJD')
  })

  it('lowers JPEG quality when the screenshot exceeds the size cap', async () => {
    const largeBase64 = 'A'.repeat(1_400_000)
    sendCommand
      .mockResolvedValueOnce({ data: largeBase64 })
      .mockResolvedValueOnce({ data: 'QQ==' })

    const { captureTabScreenshot } = await import('./navigate-screenshot.js')
    const shot = await captureTabScreenshot(3)

    expect(sendCommand).toHaveBeenCalledTimes(2)
    expect(sendCommand).toHaveBeenLastCalledWith(3, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 65,
      fromSurface: true,
    })
    expect(shot.byteLength).toBeLessThanOrEqual(1_024 * 1_024)
  })
})
