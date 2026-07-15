export type ClipboardSnapshot =
  | {
      mode: 'full'
      items: Array<{ types: Array<{ type: string; dataUrl: string }> }>
    }
  | { mode: 'text'; text: string }

export type ClipboardRestoreResult = {
  mode: 'full' | 'text' | 'failed'
  error?: string
}

setInterval(() => {
  chrome.runtime.sendMessage({ type: 'ba.keepalive' }).catch(() => undefined)
}, 20_000)

function readClipboardViaTextarea(): string {
  const ta = document.createElement('textarea')
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)
  try {
    ta.focus()
    const ok = document.execCommand('paste')
    if (!ok) throw new Error('execCommand("paste") returned false')
    return ta.value
  } finally {
    ta.remove()
  }
}

function writeClipboardViaTextarea(text: string): void {
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  ta.style.pointerEvents = 'none'
  document.body.appendChild(ta)
  try {
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    if (!ok) throw new Error('execCommand("copy") returned false')
  } finally {
    ta.remove()
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error || new Error('read blob failed'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const resp = await fetch(dataUrl)
  return resp.blob()
}

async function readClipboardSnapshot(): Promise<ClipboardSnapshot> {
  try {
    const items = await navigator.clipboard.read()
    if (items.length > 0) {
      const serialized = []
      for (const item of items) {
        const types = []
        for (const type of item.types) {
          const blob = await item.getType(type)
          types.push({ type, dataUrl: await blobToDataUrl(blob) })
        }
        serialized.push({ types })
      }
      return { mode: 'full', items: serialized }
    }
  } catch {
    // fall through
  }

  try {
    return { mode: 'text', text: await navigator.clipboard.readText() }
  } catch {
    return { mode: 'text', text: readClipboardViaTextarea() }
  }
}

async function restoreClipboardSnapshot(
  snapshot: ClipboardSnapshot,
): Promise<ClipboardRestoreResult> {
  if (snapshot.mode === 'full') {
    try {
      const items = []
      for (const item of snapshot.items) {
        const data: Record<string, Blob> = {}
        for (const entry of item.types) {
          data[entry.type] = await dataUrlToBlob(entry.dataUrl)
        }
        items.push(new ClipboardItem(data))
      }
      await navigator.clipboard.write(items)
      return { mode: 'full' }
    } catch (err) {
      const text = snapshot.items
        .flatMap((item) => item.types)
        .find((entry) => entry.type === 'text/plain')
      if (!text) {
        return { mode: 'failed', error: err instanceof Error ? err.message : String(err) }
      }
      try {
        const blob = await dataUrlToBlob(text.dataUrl)
        await navigator.clipboard.writeText(await blob.text())
        return { mode: 'text', error: err instanceof Error ? err.message : String(err) }
      } catch (fallbackError) {
        return {
          mode: 'failed',
          error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        }
      }
    }
  }

  try {
    await navigator.clipboard.writeText(snapshot.text)
    return { mode: 'text' }
  } catch (err) {
    try {
      writeClipboardViaTextarea(snapshot.text)
      return { mode: 'text', error: err instanceof Error ? err.message : String(err) }
    } catch (fallbackError) {
      return {
        mode: 'failed',
        error: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
      }
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (
    msg?.type !== 'ba.clipboard.read' &&
    msg?.type !== 'ba.clipboard.writeText' &&
    msg?.type !== 'ba.clipboard.restore'
  ) {
    return false
  }

  void (async () => {
    try {
      if (msg.type === 'ba.clipboard.read') {
        sendResponse({ ok: true, snapshot: await readClipboardSnapshot() })
        return
      }
      if (msg.type === 'ba.clipboard.restore') {
        const result = await restoreClipboardSnapshot(msg.snapshot as ClipboardSnapshot)
        sendResponse({ ok: result.mode !== 'failed', ...result })
        return
      }
      const text = String(msg.text ?? '')
      try {
        await navigator.clipboard.writeText(text)
      } catch {
        writeClipboardViaTextarea(text)
      }
      sendResponse({ ok: true })
    } catch (err) {
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })()

  return true
})
