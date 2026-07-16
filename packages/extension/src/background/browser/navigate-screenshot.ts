import type { ScreenshotResult, TabInfo } from '@browser-agent/core'
import * as cdp from './debugger.js'

const MAX_SCREENSHOT_BYTES = 1024 * 1024
const DEFAULT_JPEG_QUALITY = 80
const MIN_JPEG_QUALITY = 20

export function toTabInfo(tab: chrome.tabs.Tab): TabInfo {
  if (tab.id == null) {
    throw new Error('Tab has no id')
  }
  return {
    id: tab.id,
    title: tab.title ?? '',
    url: tab.url ?? '',
    active: tab.active ?? false,
    windowId: tab.windowId ?? 0,
    pinned: tab.pinned,
  }
}

function parseDataUrl(dataUrl: string): {
  mimeType: 'image/jpeg' | 'image/png'
  dataBase64: string
} {
  const match = /^data:(image\/(?:jpeg|png));base64,(.+)$/i.exec(dataUrl)
  if (!match?.[1] || !match[2]) {
    throw new Error('Invalid screenshot data URL')
  }
  return {
    mimeType: match[1] as 'image/jpeg' | 'image/png',
    dataBase64: match[2],
  }
}

function base64ByteLength(dataBase64: string): number {
  const padding = dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0
  return Math.floor((dataBase64.length * 3) / 4) - padding
}

function toScreenshotResult(
  mimeType: 'image/jpeg' | 'image/png',
  dataBase64: string,
): ScreenshotResult {
  return {
    mimeType,
    dataBase64,
    byteLength: base64ByteLength(dataBase64),
  }
}

export async function waitForTabLoad(tabId: number, timeoutMs = 30_000): Promise<void> {
  const tab = await chrome.tabs.get(tabId)
  if (tab.status === 'complete') {
    return
  }

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated)
      resolve()
    }, timeoutMs)

    const onUpdated = (updatedId: number, info: chrome.tabs.TabChangeInfo) => {
      if (updatedId === tabId && info.status === 'complete') {
        clearTimeout(timer)
        chrome.tabs.onUpdated.removeListener(onUpdated)
        resolve()
      }
    }

    chrome.tabs.onUpdated.addListener(onUpdated)
  })
}

export async function navigateTab(tabId: number, url: string): Promise<TabInfo> {
  await chrome.tabs.update(tabId, { url })
  await waitForTabLoad(tabId)
  const tab = await chrome.tabs.get(tabId)
  return toTabInfo(tab)
}

async function captureViaCdp(
  tabId: number,
  format: 'jpeg' | 'png',
  quality: number,
): Promise<ScreenshotResult> {
  const result = await cdp.sendCommand<{ data: string }>(tabId, 'Page.captureScreenshot', {
    format: format === 'png' ? 'png' : 'jpeg',
    quality: format === 'jpeg' ? quality : undefined,
    fromSurface: true,
  })
  if (!result.data) {
    throw new Error('CDP Page.captureScreenshot returned empty data')
  }
  return toScreenshotResult(format === 'png' ? 'image/png' : 'image/jpeg', result.data)
}

async function captureViaVisibleTab(
  windowId: number,
  format: 'jpeg' | 'png',
  quality: number,
): Promise<ScreenshotResult> {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, {
    format: format === 'png' ? 'png' : 'jpeg',
    quality: format === 'jpeg' ? quality : undefined,
  })
  const { mimeType, dataBase64 } = parseDataUrl(dataUrl)
  return toScreenshotResult(mimeType, dataBase64)
}

/**
 * Prefer CDP capture (works with host permissions + debugger, no activeTab gesture).
 * Fall back to captureVisibleTab when CDP attach is unavailable.
 */
export async function captureTabScreenshot(
  tabId: number,
  opts?: { format?: 'jpeg' | 'png'; quality?: number },
): Promise<ScreenshotResult> {
  let format = opts?.format ?? 'jpeg'
  let quality = opts?.quality ?? DEFAULT_JPEG_QUALITY

  const tab = await chrome.tabs.get(tabId)
  if (tab.windowId == null) {
    throw new Error('Tab has no window')
  }

  if (!tab.active) {
    await chrome.tabs.update(tabId, { active: true })
    await new Promise((resolve) => setTimeout(resolve, 150))
  }

  let last: ScreenshotResult | undefined
  let lastError: unknown

  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      last = await captureViaCdp(tabId, format, quality)
      lastError = undefined
    } catch (cdpError) {
      lastError = cdpError
      try {
        last = await captureViaVisibleTab(tab.windowId, format, quality)
        lastError = undefined
      } catch (visibleError) {
        lastError = visibleError
        const message =
          visibleError instanceof Error ? visibleError.message : String(visibleError)
        if (
          message.includes("'<all_urls>'") ||
          message.includes('activeTab') ||
          message.includes('Cannot access')
        ) {
          throw new Error(
            `Screenshot failed: ${message}. CDP fallback also failed (${
              cdpError instanceof Error ? cdpError.message : String(cdpError)
            }). Reload the extension after updating, then retry on an http(s) page.`,
          )
        }
        throw visibleError
      }
    }

    if (!last) {
      break
    }

    if (last.byteLength <= MAX_SCREENSHOT_BYTES) {
      return last
    }

    if (format === 'png') {
      format = 'jpeg'
      quality = DEFAULT_JPEG_QUALITY
      continue
    }

    if (quality <= MIN_JPEG_QUALITY) {
      break
    }

    quality = Math.max(MIN_JPEG_QUALITY, quality - 15)
  }

  if (last) return last
  throw lastError instanceof Error
    ? lastError
    : new Error(lastError ? String(lastError) : 'Screenshot capture failed')
}
