import type { A11yFilter, A11yTreeResult } from '@browser-agent/core'

const A11Y_SCRIPT_MARKER = 'a11y-tree'

function getA11yScriptFiles(): string[] {
  const scripts = chrome.runtime.getManifest().content_scripts ?? []
  for (const entry of scripts) {
    const files = entry.js ?? []
    if (files.some((file) => file.includes(A11Y_SCRIPT_MARKER))) {
      return files
    }
  }
  return []
}

async function runInPage<T>(
  tabId: number,
  func: (...args: never[]) => T,
  args: never[] = [],
): Promise<T> {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    injectImmediately: true,
    func,
    args,
    world: 'ISOLATED',
  })
  if (!results.length || results[0]?.result === undefined) {
    throw new Error('Page script returned no result')
  }
  return results[0].result as T
}

/** Ensure the a11y-tree content script is present in all frames (isolated world). */
export async function ensureA11yInjected(tabId: number): Promise<void> {
  const exists = await runInPage<boolean>(
    tabId,
    () => typeof window.__baGenerateA11yTree === 'function',
  ).catch(() => false)
  if (exists) return

  const files = getA11yScriptFiles()
  if (!files.length) {
    throw new Error('a11y-tree content script not listed in manifest content_scripts')
  }

  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    files,
    world: 'ISOLATED',
  })
}

export type GenerateA11yTreeOptions = {
  filter?: A11yFilter
  maxDepth?: number
  maxChars?: number
  refId?: string
}

/** Run __baGenerateA11yTree in the tab's main frame after injection. */
export async function generateA11yTree(
  tabId: number,
  opts: GenerateA11yTreeOptions = {},
): Promise<A11yTreeResult> {
  await ensureA11yInjected(tabId)

  const result = await runInPage(
    tabId,
    ((filter: A11yFilter, maxDepth: number, maxChars: number | null, refId: string | null) => {
      if (typeof window.__baGenerateA11yTree !== 'function') {
        return {
          error: 'a11y tree script not injected',
          pageContent: '',
          viewport: { width: window.innerWidth, height: window.innerHeight },
        }
      }
      return window.__baGenerateA11yTree(filter, maxDepth, maxChars, refId)
    }) as (...args: never[]) => A11yTreeResult,
    [
      opts.filter ?? 'all',
      opts.maxDepth ?? 15,
      opts.maxChars ?? null,
      opts.refId ?? null,
    ] as never[],
  )

  return result
}

export type ResolveRefResult =
  | { ok: true; x: number; y: number }
  | { ok: false; error: string }

export type SelectRefResult =
  | { ok: true; selected: string }
  | { ok: false; error: string }

/** Resolve ref_id to viewport center coordinates in the tab's main frame. */
export async function resolveRef(tabId: number, refId: string): Promise<ResolveRefResult> {
  await ensureA11yInjected(tabId)
  return runInPage(
    tabId,
    ((id: string) => {
      if (typeof window.__baResolveRef !== 'function') {
        return { ok: false as const, error: 'a11y tree script not injected' }
      }
      return window.__baResolveRef(id)
    }) as (...args: never[]) => ResolveRefResult,
    [refId] as never[],
  )
}

/** Set a <select> value by ref_id using value or visible label. */
export async function selectRef(
  tabId: number,
  refId: string,
  opts: { value?: string; label?: string },
): Promise<SelectRefResult> {
  await ensureA11yInjected(tabId)
  return runInPage(
    tabId,
    ((id: string, value: string | null, label: string | null) => {
      if (typeof window.__baSelectRef !== 'function') {
        return { ok: false as const, error: 'a11y tree script not injected' }
      }
      return window.__baSelectRef(id, value, label)
    }) as (...args: never[]) => SelectRefResult,
    [refId, opts.value ?? null, opts.label ?? null] as never[],
  )
}

declare global {
  interface Window {
    __baGenerateA11yTree: (
      filter?: 'all' | 'interactive',
      maxDepth?: number,
      maxChars?: number | null,
      refId?: string | null,
    ) => A11yTreeResult
    __baResolveRef: (refId: string) => ResolveRefResult
    __baSelectRef: (
      refId: string,
      value?: string | null,
      label?: string | null,
    ) => SelectRefResult
  }
}
