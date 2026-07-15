import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addTabToSessionGroup,
  createGroupForSession,
  getSessionByTab,
  getSessionGroup,
  resetTabGroupsForTests,
} from './tab-group.js'

describe('tab groups (DHR-65)', () => {
  beforeEach(() => {
    resetTabGroupsForTests()
    vi.stubGlobal('chrome', {
      tabs: {
        group: vi.fn(async () => 100),
        query: vi.fn(async () => []),
        ungroup: vi.fn(async () => undefined),
      },
      tabGroups: {
        get: vi.fn(async () => ({ id: 100, title: 'Agent', color: 'blue' })),
        update: vi.fn(async () => ({ id: 100 })),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC: agent seed tab appears in a dedicated group', async () => {
    const groupId = await createGroupForSession('sess-1', 11, 'Fill form')
    expect(groupId).toBe(100)
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: 11 })
    expect(chrome.tabGroups.update).toHaveBeenCalledWith(
      100,
      expect.objectContaining({ title: 'Agent: Fill form' }),
    )
    expect(getSessionGroup('sess-1')).toBe(100)
    expect(getSessionByTab(11)).toBe('sess-1')
  })

  it('AC: agent-opened tabs join the session group; unrelated tabs stay unmapped', async () => {
    await createGroupForSession('sess-1', 11)
    await addTabToSessionGroup('sess-1', 22)
    expect(chrome.tabs.group).toHaveBeenCalledWith({ tabIds: 22, groupId: 100 })
    expect(getSessionByTab(22)).toBe('sess-1')
    expect(getSessionByTab(99)).toBeUndefined()
  })

  it('records ownership when chrome:// seed cannot be grouped', async () => {
    vi.mocked(chrome.tabs.group).mockRejectedValueOnce(new Error('Cannot group this tab'))
    const groupId = await createGroupForSession('sess-2', 5)
    expect(groupId).toBe(-1)
    expect(getSessionByTab(5)).toBe('sess-2')
    expect(getSessionGroup('sess-2')).toBeUndefined()
  })
})
