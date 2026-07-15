import type {
  ClickOptions,
  HoverOptions,
  ResolveRefResult,
  ScrollOptions,
  SelectOptions,
  TypeOptions,
} from '@browser-agent/core'
import { resolveRef, selectRef } from './a11y.js'
import * as cdp from './debugger.js'

type PointInput = { refId?: string; x?: number; y?: number }

async function resolvePoint(
  tabId: number,
  input: PointInput,
  label: string,
): Promise<{ x: number; y: number; refId?: string }> {
  if (input.refId?.trim()) {
    const refId = input.refId.trim()
    const result = await resolveRef(tabId, refId)
    if (!result.ok) throw new Error(result.error)
    return { x: result.x, y: result.y, refId }
  }
  if (input.x != null && input.y != null) {
    return { x: Math.round(input.x), y: Math.round(input.y) }
  }
  throw new Error(`${label}: provide refId or both x and y`)
}

export async function actClick(
  tabId: number,
  opts: ClickOptions,
): Promise<{ x: number; y: number; refId?: string }> {
  const point = await resolvePoint(tabId, opts, 'click')
  await cdp.mouseClick(tabId, point.x, point.y, opts.button ?? 'left', opts.clickCount ?? 1)
  return point
}

export async function actHover(
  tabId: number,
  opts: HoverOptions,
): Promise<{ x: number; y: number; refId?: string }> {
  const point = await resolvePoint(tabId, opts, 'hover')
  await cdp.mouseMove(tabId, point.x, point.y)
  return point
}

export async function actType(
  tabId: number,
  opts: TypeOptions,
): Promise<{ typed: string; refId?: string }> {
  if (opts.refId?.trim()) {
    const point = await resolvePoint(tabId, { refId: opts.refId }, 'type')
    await cdp.mouseClick(tabId, point.x, point.y)
    await new Promise((resolve) => setTimeout(resolve, 80))
  }
  await cdp.insertText(tabId, opts.text)
  return { typed: opts.text, refId: opts.refId?.trim() }
}

export async function actScroll(
  tabId: number,
  opts: ScrollOptions,
): Promise<{ direction: ScrollOptions['direction'] }> {
  const tab = await chrome.tabs.get(tabId)
  const width = tab.width ?? 1280
  const height = tab.height ?? 800
  const cx = Math.round(width / 2)
  const cy = Math.round(height / 2)
  const amount = opts.amount ?? Math.round(height * 0.7)

  switch (opts.direction) {
    case 'down':
      await cdp.mouseWheel(tabId, cx, cy, 0, amount)
      break
    case 'up':
      await cdp.mouseWheel(tabId, cx, cy, 0, -amount)
      break
    case 'top':
      await cdp.evaluate(tabId, 'window.scrollTo({ top: 0, behavior: "instant" })')
      break
    case 'bottom':
      await cdp.evaluate(
        tabId,
        'window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" })',
      )
      break
  }

  return { direction: opts.direction }
}

export async function actSelect(
  tabId: number,
  opts: SelectOptions,
): Promise<{ selected: string; refId: string }> {
  if (!opts.value && !opts.label) {
    throw new Error('select: provide value or label')
  }
  const result = await selectRef(tabId, opts.refId, { value: opts.value, label: opts.label })
  if (!result.ok) throw new Error(result.error)
  return { selected: result.selected, refId: opts.refId }
}

export async function actResolveRef(tabId: number, refId: string): Promise<ResolveRefResult> {
  return resolveRef(tabId, refId)
}
