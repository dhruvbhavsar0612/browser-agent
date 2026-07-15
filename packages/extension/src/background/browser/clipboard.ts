import type { ClipboardRestoreResult, ClipboardSnapshot } from '../../offscreen/clipboard.js'

const OFFSCREEN_URL = 'src/offscreen/offscreen.html'

let creating: Promise<void> | null = null

export async function ensureClipboardOffscreen(): Promise<void> {
  const hasDocument = await chrome.offscreen.hasDocument?.()
  if (hasDocument) return

  if (!creating) {
    creating = chrome.offscreen
      .createDocument({
        url: OFFSCREEN_URL,
        reasons: [chrome.offscreen.Reason.CLIPBOARD, chrome.offscreen.Reason.BLOBS],
        justification: 'Temporary clipboard snapshot/restore for rich-text typing',
      })
      .catch(async (err) => {
        if (await chrome.offscreen.hasDocument?.()) return
        throw err
      })
      .finally(() => {
        creating = null
      })
  }

  await creating
}

export async function clipboardReadSnapshot(): Promise<ClipboardSnapshot> {
  await ensureClipboardOffscreen()
  const resp = await chrome.runtime.sendMessage({ type: 'ba.clipboard.read' })
  if (!resp?.ok) throw new Error(resp?.error || 'Failed to read clipboard')
  return resp.snapshot as ClipboardSnapshot
}

export async function clipboardWriteText(text: string): Promise<void> {
  await ensureClipboardOffscreen()
  const resp = await chrome.runtime.sendMessage({ type: 'ba.clipboard.writeText', text })
  if (!resp?.ok) throw new Error(resp?.error || 'Failed to write clipboard')
}

export async function restoreClipboardSnapshot(
  snapshot: ClipboardSnapshot,
): Promise<ClipboardRestoreResult> {
  await ensureClipboardOffscreen()
  const resp = await chrome.runtime.sendMessage({
    type: 'ba.clipboard.restore',
    snapshot,
  })
  if (!resp?.ok) {
    return { mode: 'failed', error: resp?.error || 'Failed to restore clipboard' }
  }
  return {
    mode: resp.mode as ClipboardRestoreResult['mode'],
    error: resp.error,
  }
}

/**
 * Snapshot → write agent text → run paste action → restore user clipboard.
 */
export async function withTemporaryClipboard<T>(
  text: string,
  run: () => Promise<T>,
): Promise<{ result: T; clipboardRestore: ClipboardRestoreResult }> {
  let original: ClipboardSnapshot
  try {
    original = await clipboardReadSnapshot()
  } catch (err) {
    throw new Error(
      `Failed to snapshot clipboard; paste typing aborted to avoid overwriting user clipboard: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }

  await clipboardWriteText(text)

  let result: T
  let caught: unknown
  try {
    result = await run()
  } catch (err) {
    caught = err
    result = undefined as T
  }

  const clipboardRestore = await restoreClipboardSnapshot(original)

  if (caught) {
    const error = caught instanceof Error ? caught : new Error(String(caught))
    ;(error as Error & { clipboardRestore?: ClipboardRestoreResult }).clipboardRestore =
      clipboardRestore
    throw error
  }

  return { result, clipboardRestore }
}
