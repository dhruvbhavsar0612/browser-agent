/**
 * Subtle visual cue that a tab is under agent control.
 * Top-edge bar + corner badge; pointer-events none so page UI stays usable.
 */

const STYLE_ID = 'ba-agent-indicator-css'
const ROOT_ID = 'ba-agent-indicator-root'
const ACCENT = '#2b6cb0'

declare global {
  interface Window {
    __baIndicatorInstalled?: boolean
  }
}

if (!window.__baIndicatorInstalled) {
  window.__baIndicatorInstalled = true

  let root: HTMLDivElement | null = null
  let visible = false

  function ensureStyles(): void {
    if (document.getElementById(STYLE_ID)) return
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
      @keyframes ba-agent-pulse {
        0%, 100% { opacity: 0.85; }
        50% { opacity: 1; }
      }
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483646;
      }
      #${ROOT_ID} .ba-agent-bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, ${ACCENT}, #5ba4e8, ${ACCENT});
        box-shadow: 0 0 12px rgba(43, 108, 176, 0.45);
        animation: ba-agent-pulse 2s ease-in-out infinite;
      }
      #${ROOT_ID} .ba-agent-badge {
        position: absolute;
        top: 10px;
        right: 10px;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 5px 10px;
        border-radius: 999px;
        background: rgba(18, 23, 30, 0.88);
        color: #e8eef4;
        font: 600 11px/1.2 "IBM Plex Sans", system-ui, sans-serif;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        border: 1px solid rgba(91, 164, 232, 0.45);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      }
      #${ROOT_ID} .ba-agent-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #5ba4e8;
        box-shadow: 0 0 0 3px rgba(91, 164, 232, 0.25);
      }
    `
    ;(document.head || document.documentElement).appendChild(style)
  }

  function show(): void {
    ensureStyles()
    if (!root) {
      root = document.createElement('div')
      root.id = ROOT_ID
      root.setAttribute('data-ba-agent', 'active')
      root.innerHTML =
        '<div class="ba-agent-bar" aria-hidden="true"></div>' +
        '<div class="ba-agent-badge" role="status" aria-live="polite">' +
        '<span class="ba-agent-dot" aria-hidden="true"></span>Agent active</div>'
      ;(document.body || document.documentElement).appendChild(root)
    }
    visible = true
  }

  function hide(): void {
    if (root?.parentNode) root.parentNode.removeChild(root)
    root = null
    visible = false
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || typeof message !== 'object') return false
    const type = (message as { type?: string }).type
    if (type === 'ba.indicator.show') {
      show()
      sendResponse({ ok: true, visible: true })
      return true
    }
    if (type === 'ba.indicator.hide') {
      hide()
      sendResponse({ ok: true, visible: false })
      return true
    }
    if (type === 'ba.indicator.status') {
      sendResponse({ ok: true, visible })
      return true
    }
    return false
  })
}

/** Test helpers when imported as a module under happy-dom. */
export function __baIndicatorTestApi() {
  return {
    isInstalled: () => Boolean(window.__baIndicatorInstalled),
    hasRoot: () => Boolean(document.getElementById(ROOT_ID)),
  }
}
