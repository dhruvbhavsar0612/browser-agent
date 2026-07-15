/**
 * Per-session Chrome tab groups for agent-opened tabs.
 */

const GROUP_TITLE_PREFIX = 'Agent'
const COLORS = [
  'blue',
  'cyan',
  'green',
  'yellow',
  'orange',
  'red',
  'pink',
  'purple',
] as const

type TabGroupColor = (typeof COLORS)[number]

let colorRotation = 0

const sessionToGroup = new Map<string, number>()
const tabToSession = new Map<number, string>()

export function getSessionGroup(sessionId: string): number | undefined {
  return sessionToGroup.get(sessionId)
}

export function getSessionByTab(tabId: number): string | undefined {
  return tabToSession.get(tabId)
}

export async function createGroupForSession(
  sessionId: string,
  seedTabId: number,
  title?: string,
): Promise<number> {
  const existing = sessionToGroup.get(sessionId)
  if (existing != null) {
    try {
      await chrome.tabGroups.get(existing)
      tabToSession.set(seedTabId, sessionId)
      return existing
    } catch {
      sessionToGroup.delete(sessionId)
    }
  }

  tabToSession.set(seedTabId, sessionId)

  try {
    const color: TabGroupColor = COLORS[colorRotation++ % COLORS.length]!
    const groupId = await chrome.tabs.group({ tabIds: seedTabId })
    await chrome.tabGroups.update(groupId, {
      title: formatGroupTitle(title),
      color,
    })
    sessionToGroup.set(sessionId, groupId)
    return groupId
  } catch {
    // chrome:// and similar pages cannot join groups — retry later on navigate/open.
    return -1
  }
}

export async function ensureGroupForSession(sessionId: string, title?: string): Promise<number | null> {
  const existing = sessionToGroup.get(sessionId)
  if (existing != null) return existing

  for (const [tabId, sid] of tabToSession.entries()) {
    if (sid !== sessionId) continue
    const groupId = await createGroupForSession(sessionId, tabId, title)
    return groupId >= 0 ? groupId : null
  }
  return null
}

export async function addTabToSessionGroup(
  sessionId: string,
  tabId: number,
  title?: string,
): Promise<void> {
  let groupId = sessionToGroup.get(sessionId)
  if (groupId == null) {
    const created = await ensureGroupForSession(sessionId, title)
    if (created == null) {
      tabToSession.set(tabId, sessionId)
      return
    }
    groupId = created
  }

  try {
    await chrome.tabs.group({ tabIds: tabId, groupId })
    tabToSession.set(tabId, sessionId)
  } catch {
    tabToSession.set(tabId, sessionId)
  }
}

export async function updateSessionGroupTitle(sessionId: string, title: string): Promise<void> {
  const groupId = sessionToGroup.get(sessionId)
  if (groupId == null) return
  try {
    await chrome.tabGroups.update(groupId, { title: formatGroupTitle(title) })
  } catch {
    // group may have been dissolved by the user
  }
}

export async function dissolveSessionGroup(sessionId: string): Promise<void> {
  const groupId = sessionToGroup.get(sessionId)
  sessionToGroup.delete(sessionId)
  for (const [tabId, sid] of [...tabToSession.entries()]) {
    if (sid === sessionId) tabToSession.delete(tabId)
  }
  if (groupId == null) return
  try {
    const tabs = await chrome.tabs.query({ groupId })
    const ids = tabs.map((tab) => tab.id).filter((id): id is number => id != null)
    if (ids.length > 0) await chrome.tabs.ungroup(ids)
  } catch {
    // ignore
  }
}

export function forgetTab(tabId: number): void {
  tabToSession.delete(tabId)
}

export function resetTabGroupsForTests(): void {
  sessionToGroup.clear()
  tabToSession.clear()
  colorRotation = 0
}

function formatGroupTitle(title?: string): string {
  const cleaned = title?.replace(/\s+/g, ' ').trim()
  if (!cleaned) return GROUP_TITLE_PREFIX
  const short = cleaned.length > 28 ? `${cleaned.slice(0, 25)}…` : cleaned
  return `${GROUP_TITLE_PREFIX}: ${short}`
}
