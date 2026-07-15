/**
 * Show / hide agent visual indicator on a tab via content-script messaging.
 */

const indicatedTabs = new Set<number>()

export function getIndicatedTabIds(): number[] {
  return [...indicatedTabs]
}

export async function showAgentIndicator(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ba.indicator.show' })
    indicatedTabs.add(tabId)
  } catch {
    // Content script may be unavailable (chrome://, PDF, etc.)
  }
}

export async function hideAgentIndicator(tabId: number): Promise<void> {
  indicatedTabs.delete(tabId)
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ba.indicator.hide' })
  } catch {
    // Tab gone or no content script
  }
}

export async function hideAllAgentIndicators(): Promise<void> {
  const tabIds = getIndicatedTabIds()
  await Promise.all(tabIds.map((tabId) => hideAgentIndicator(tabId)))
  indicatedTabs.clear()
}

/** Test helper */
export function resetIndicatorsForTests(): void {
  indicatedTabs.clear()
}
