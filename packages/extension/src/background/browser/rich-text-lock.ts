/**
 * Blocks further typing after a failed rich-text/clipboard paste until navigate.
 */

type DirtyState = {
  reason: string
  url?: string
  at: number
}

const dirtyTabs = new Map<number, DirtyState>()

export function setRichTextDirty(tabId: number, reason: string, url?: string): void {
  dirtyTabs.set(tabId, { reason, url, at: Date.now() })
}

export function clearRichTextDirty(tabId: number): void {
  dirtyTabs.delete(tabId)
}

export function getRichTextDirty(tabId: number): DirtyState | undefined {
  return dirtyTabs.get(tabId)
}

export async function assertTypeAllowed(tabId: number): Promise<void> {
  const dirty = dirtyTabs.get(tabId)
  if (!dirty) return

  try {
    const tab = await chrome.tabs.get(tabId)
    if (dirty.url && tab.url && dirty.url !== tab.url) {
      dirtyTabs.delete(tabId)
      return
    }
  } catch {
    dirtyTabs.delete(tabId)
    return
  }

  throw new Error(
    `Previous rich-text input failed; further typing is blocked until navigate. Reason: ${dirty.reason}`,
  )
}

export function resetRichTextDirtyForTests(): void {
  dirtyTabs.clear()
}
