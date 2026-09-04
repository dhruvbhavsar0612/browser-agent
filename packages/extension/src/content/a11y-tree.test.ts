import { beforeEach, describe, expect, it } from 'vitest'
import './a11y-tree.js'

function makeElementsVisible(root: ParentNode = document): void {
  for (const el of root.querySelectorAll('button, a, input, h1, p, select, textarea')) {
    const htmlEl = el as HTMLElement
    Object.defineProperty(htmlEl, 'offsetWidth', { configurable: true, value: 120 })
    Object.defineProperty(htmlEl, 'offsetHeight', { configurable: true, value: 32 })
    htmlEl.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        bottom: 32,
        right: 120,
        width: 120,
        height: 32,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  }
}

function loadFixture(html: string): void {
  document.documentElement.innerHTML = html
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1024 })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 768 })
  makeElementsVisible()
}

describe('a11y-tree', () => {
  beforeEach(() => {
    loadFixture(`
      <body>
        <h1>Welcome</h1>
        <button id="submit-btn">Submit</button>
        <a href="/docs">Documentation</a>
        <input id="search" type="text" placeholder="Search" />
        <p>Static paragraph text</p>
      </body>
    `)
    Element.prototype.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        bottom: 100,
        right: 100,
        width: 100,
        height: 100,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  })

  it('emits role, label, and ref lines', () => {
    const result = window.__baGenerateA11yTree('all')
    expect(result.pageContent).toContain('heading "Welcome" [ref_')
    expect(result.pageContent).toContain('button "Submit" [ref_')
    expect(result.pageContent).toContain('link "Documentation" [ref_')
    expect(result.pageContent).toContain('textbox "Search" [ref_')
    expect(result.viewport).toEqual({ width: 1024, height: 768 })
  })

  it('keeps stable refs for the same element within a snapshot', () => {
    const first = window.__baGenerateA11yTree('interactive')
    const second = window.__baGenerateA11yTree('interactive')

    const firstBtnRef = first.pageContent.match(/button "Submit" \[(ref_\d+)\]/)?.[1]
    const secondBtnRef = second.pageContent.match(/button "Submit" \[(ref_\d+)\]/)?.[1]
    expect(firstBtnRef).toBeTruthy()
    expect(secondBtnRef).toBe(firstBtnRef)
  })

  it('filters to interactive elements only', () => {
    const result = window.__baGenerateA11yTree('interactive')
    expect(result.pageContent).toContain('button "Submit"')
    expect(result.pageContent).toContain('link "Documentation"')
    expect(result.pageContent).not.toContain('heading "Welcome"')
    expect(result.pageContent).not.toContain('Static paragraph')
  })

  it('truncates pageContent when maxChars is exceeded', () => {
    const full = window.__baGenerateA11yTree('all')
    const limit = 40
    const truncated = window.__baGenerateA11yTree('all', 15, limit)

    expect(full.pageContent.length).toBeGreaterThan(limit)
    expect(truncated.pageContent.length).toBe(limit)
    expect(truncated.truncated).toBe(true)
    expect(truncated.error).toBeUndefined()
  })

  it('resolves ref_id to center coordinates', () => {
    window.__baGenerateA11yTree('interactive')
    const ref = window.__baGenerateA11yTree('interactive').pageContent.match(
      /button "Submit" \[(ref_\d+)\]/,
    )?.[1]
    expect(ref).toBeTruthy()
    const resolved = window.__baResolveRef(ref!)
    expect(resolved).toEqual({ ok: true, x: 60, y: 16 })
  })

  it('selects option on select element by label', () => {
    loadFixture(`
      <body>
        <select id="country">
          <option value="us">United States</option>
          <option value="ca">Canada</option>
        </select>
      </body>
    `)
    window.__baGenerateA11yTree('interactive')
    const ref = window.__baGenerateA11yTree('interactive').pageContent.match(
      /combobox.*\[(ref_\d+)\]/,
    )?.[1]
    expect(ref).toBeTruthy()
    const result = window.__baSelectRef(ref!, null, 'Canada')
    expect(result).toEqual({ ok: true, selected: 'Canada' })
    const select = document.querySelector('#country') as HTMLSelectElement
    expect(select.value).toBe('ca')
  })

  it('resolves a zero-size wrapper using a visible child', () => {
    loadFixture(`
      <body>
        <div role="listbox">
          <div role="option" id="wrap" aria-label="California"><span id="label">California</span></div>
        </div>
      </body>
    `)
    const wrap = document.getElementById('wrap') as HTMLElement
    const label = document.getElementById('label') as HTMLElement
    wrap.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    wrap.getClientRects = () => [] as unknown as DOMRectList
    label.getBoundingClientRect = () =>
      ({
        top: 10,
        left: 20,
        bottom: 34,
        right: 100,
        width: 80,
        height: 24,
        x: 20,
        y: 10,
        toJSON: () => ({}),
      }) as DOMRect

    const tree = window.__baGenerateA11yTree('all')
    const ref = tree.pageContent.match(/option "California" \[(ref_\d+)\]/)?.[1]
    expect(ref).toBeTruthy()
    expect(window.__baResolveRef(ref!)).toEqual({ ok: true, x: 60, y: 22 })
  })

  it('does not use a zero-size closest button over the element itself', () => {
    loadFixture(`
      <body>
        <button id="outer"><span id="inner">California</span></button>
      </body>
    `)
    const outer = document.getElementById('outer') as HTMLElement
    const inner = document.getElementById('inner') as HTMLElement
    outer.getBoundingClientRect = () =>
      ({
        top: 0,
        left: 0,
        bottom: 0,
        right: 0,
        width: 0,
        height: 0,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
    inner.getBoundingClientRect = () =>
      ({
        top: 8,
        left: 8,
        bottom: 32,
        right: 88,
        width: 80,
        height: 24,
        x: 8,
        y: 8,
        toJSON: () => ({}),
      }) as DOMRect

    const tree = window.__baGenerateA11yTree('all')
    const ref = tree.pageContent.match(/button "California" \[(ref_\d+)\]/)?.[1]
    expect(ref).toBeTruthy()
    expect(window.__baResolveRef(ref!)).toEqual({ ok: true, x: 48, y: 20 })
  })

  it('explains when a ref is hidden instead of only reporting a missing box', () => {
    loadFixture(`
      <body>
        <button id="hidden">California</button>
      </body>
    `)
    const hidden = document.getElementById('hidden') as HTMLElement
    hidden.style.display = 'none'
    const tree = window.__baGenerateA11yTree('all')
    const ref = tree.pageContent.match(/button "California" \[(ref_\d+)\]/)?.[1]
    expect(ref).toBeTruthy()
    const resolved = window.__baResolveRef(ref!)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.error).toMatch(/hidden or collapsed/)
    }
  })
})

declare global {
  interface Window {
    __baGenerateA11yTree: (
      filter?: 'all' | 'interactive',
      maxDepth?: number,
      maxChars?: number | null,
      refId?: string | null,
    ) => {
      pageContent: string
      viewport: { width: number; height: number }
      error?: string
      truncated?: boolean
    }
    __baResolveRef: (refId: string) =>
      | { ok: true; x: number; y: number }
      | { ok: false; error: string }
    __baSelectRef: (
      refId: string,
      value?: string | null,
      label?: string | null,
    ) => { ok: true; selected: string } | { ok: false; error: string }
  }
}
