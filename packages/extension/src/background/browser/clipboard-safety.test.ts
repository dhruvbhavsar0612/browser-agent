import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  assertTypeAllowed,
  clearRichTextDirty,
  getRichTextDirty,
  resetRichTextDirtyForTests,
  setRichTextDirty,
} from './rich-text-lock.js'
import { withTemporaryClipboard } from './clipboard.js'

describe('rich-text dirty lock (DHR-69)', () => {
  beforeEach(() => {
    resetRichTextDirtyForTests()
    vi.stubGlobal('chrome', {
      tabs: {
        get: vi.fn(async () => ({ id: 3, url: 'https://example.com/editor' })),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC: dirty lock blocks further type until navigate clears it', async () => {
    setRichTextDirty(3, 'paste failed', 'https://example.com/editor')
    await expect(assertTypeAllowed(3)).rejects.toThrow(/blocked until navigate/)

    clearRichTextDirty(3)
    await expect(assertTypeAllowed(3)).resolves.toBeUndefined()
    expect(getRichTextDirty(3)).toBeUndefined()
  })

  it('auto-clears when tab URL changed (navigate happened)', async () => {
    setRichTextDirty(3, 'paste failed', 'https://example.com/old')
    vi.mocked(chrome.tabs.get).mockResolvedValueOnce({
      id: 3,
      url: 'https://example.com/new',
    } as chrome.tabs.Tab)
    await expect(assertTypeAllowed(3)).resolves.toBeUndefined()
    expect(getRichTextDirty(3)).toBeUndefined()
  })
})

describe('clipboard snapshot/restore helpers (DHR-69)', () => {
  beforeEach(() => {
    vi.stubGlobal('chrome', {
      offscreen: {
        hasDocument: vi.fn(async () => true),
        createDocument: vi.fn(async () => undefined),
        Reason: { CLIPBOARD: 'CLIPBOARD', BLOBS: 'BLOBS' },
      },
      runtime: {
        sendMessage: vi.fn(async (msg: { type: string }) => {
          if (msg.type === 'ba.clipboard.read') {
            return { ok: true, snapshot: { mode: 'text', text: 'user-clip' } }
          }
          if (msg.type === 'ba.clipboard.writeText') {
            return { ok: true }
          }
          if (msg.type === 'ba.clipboard.restore') {
            return { ok: true, mode: 'text' }
          }
          return { ok: false, error: 'unknown' }
        }),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('AC: restores clipboard after paste run in common case', async () => {
    const run = vi.fn(async () => 'ok')
    const result = await withTemporaryClipboard('agent text', run)
    expect(run).toHaveBeenCalled()
    expect(result.clipboardRestore.mode).toBe('text')
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'ba.clipboard.read' })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ba.clipboard.writeText',
      text: 'agent text',
    })
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'ba.clipboard.restore',
      snapshot: { mode: 'text', text: 'user-clip' },
    })
  })

  it('AC: reports restore failure mode on the error path', async () => {
    vi.mocked(chrome.runtime.sendMessage).mockImplementation(async (message: unknown) => {
      const msg = message as { type: string }
      if (msg.type === 'ba.clipboard.read') {
        return { ok: true, snapshot: { mode: 'text', text: 'user-clip' } }
      }
      if (msg.type === 'ba.clipboard.writeText') return { ok: true }
      if (msg.type === 'ba.clipboard.restore') {
        return { ok: false, error: 'permission denied', mode: 'failed' }
      }
      return { ok: false }
    })

    await expect(
      withTemporaryClipboard('x', async () => {
        throw new Error('paste failed')
      }),
    ).rejects.toMatchObject({
      message: 'paste failed',
      clipboardRestore: { mode: 'failed', error: 'permission denied' },
    })
  })
})
