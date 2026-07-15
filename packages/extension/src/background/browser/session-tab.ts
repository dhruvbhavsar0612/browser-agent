const sessionTabs = new Map<string, number>()

export function bindSessionTab(sessionId: string, tabId: number): void {
  sessionTabs.set(sessionId, tabId)
}

export function getBoundTabId(sessionId: string): number | undefined {
  return sessionTabs.get(sessionId)
}

export function clearSessionTab(sessionId: string): void {
  sessionTabs.delete(sessionId)
}

/** Test helper — reset in-memory bindings. */
export function resetSessionTabsForTests(): void {
  sessionTabs.clear()
}
