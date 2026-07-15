/**
 * CDP (chrome.debugger) wrapper: attach/detach/sendCommand with per-tab session tracking.
 * Input helpers used by act tools (click, type, scroll, hover).
 */

const CDP_VERSION = '1.3'
const DEFAULT_TIMEOUT_MS = 30_000

const attachedTabs = new Set<number>()

export function isDebuggerAttached(tabId: number): boolean {
  return attachedTabs.has(tabId)
}

export function getAttachedTabIds(): number[] {
  return [...attachedTabs]
}

function cleanupTabState(tabId: number): void {
  attachedTabs.delete(tabId)
}

export async function attach(tabId: number): Promise<void> {
  if (attachedTabs.has(tabId)) return

  await new Promise<void>((resolve, reject) => {
    chrome.debugger.attach({ tabId }, CDP_VERSION, () => {
      const err = chrome.runtime.lastError
      if (err && !err.message?.includes('already attached')) {
        reject(new Error(err.message ?? 'debugger.attach failed'))
        return
      }
      attachedTabs.add(tabId)
      resolve()
    })
  })
}

export async function detach(tabId: number): Promise<void> {
  if (!attachedTabs.has(tabId)) return

  await new Promise<void>((resolve) => {
    chrome.debugger.detach({ tabId }, () => {
      cleanupTabState(tabId)
      resolve()
    })
  })
}

export async function detachAll(): Promise<void> {
  const tabIds = getAttachedTabIds()
  await Promise.all(tabIds.map((tabId) => detach(tabId)))
}

export async function sendCommand<T = unknown>(
  tabId: number,
  method: string,
  params?: object,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  await attach(tabId)

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`CDP call ${method} timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    chrome.debugger.sendCommand({ tabId }, method, params ?? {}, (result) => {
      clearTimeout(timer)
      const err = chrome.runtime.lastError
      if (err) {
        reject(new Error(err.message ?? `CDP ${method} failed`))
        return
      }
      resolve(result as T)
    })
  })
}

export async function mouseClick(
  tabId: number,
  x: number,
  y: number,
  button: 'left' | 'right' = 'left',
  clickCount = 1,
): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button,
    clickCount,
  })
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button,
    clickCount,
  })
}

export async function mouseMove(tabId: number, x: number, y: number): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
}

export async function mouseWheel(
  tabId: number,
  x: number,
  y: number,
  deltaX: number,
  deltaY: number,
): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchMouseEvent', {
    type: 'mouseWheel',
    x,
    y,
    deltaX,
    deltaY,
  })
}

export async function insertText(tabId: number, text: string): Promise<void> {
  await sendCommand(tabId, 'Input.insertText', { text })
}

/** Chromium editor Paste command (real paste path for contenteditable / ProseMirror). */
export async function paste(tabId: number): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'v',
    code: 'KeyV',
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    modifiers: 4,
    commands: ['Paste'],
  })
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'v',
    code: 'KeyV',
    windowsVirtualKeyCode: 86,
    nativeVirtualKeyCode: 86,
    modifiers: 4,
  })
}

export async function pressKey(
  tabId: number,
  key: string,
  code?: string,
  modifiers = 0,
): Promise<void> {
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: code ?? key,
    modifiers,
  })
  await sendCommand(tabId, 'Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: code ?? key,
    modifiers,
  })
}

export async function evaluate<T = unknown>(tabId: number, expression: string): Promise<T> {
  const result = await sendCommand<{ result: { value?: T } }>(tabId, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
  })
  return result.result.value as T
}

let cleanupListenersRegistered = false

function registerCleanupListeners(): void {
  if (cleanupListenersRegistered) return
  cleanupListenersRegistered = true

  if (typeof chrome === 'undefined') return

  chrome.tabs.onRemoved.addListener((tabId) => {
    cleanupTabState(tabId)
  })

  chrome.debugger.onDetach.addListener((source) => {
    if (source.tabId != null) {
      cleanupTabState(source.tabId)
    }
  })
}

registerCleanupListeners()
