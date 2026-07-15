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
  }
}
