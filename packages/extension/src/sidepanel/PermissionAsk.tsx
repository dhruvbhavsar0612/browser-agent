import type { PermissionReply } from '@browser-agent/core'
import './PermissionAsk.css'

export type PermissionAskRequest = {
  requestId: string
  permission: string
  patterns: string[]
  metadata?: unknown
}

export type PermissionAskProps = {
  request: PermissionAskRequest
  busy?: boolean
  onReply: (response: PermissionReply) => void
}

function summarizeMetadata(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object') return null
  const record = metadata as Record<string, unknown>
  if (typeof record.toolName === 'string' && typeof record.count === 'number') {
    return `Repeated “${record.toolName}” ${record.count} times`
  }
  try {
    const text = JSON.stringify(metadata)
    return text.length > 120 ? `${text.slice(0, 117)}…` : text
  } catch {
    return null
  }
}

export function PermissionAskBanner({ request, busy, onReply }: PermissionAskProps) {
  const isDoom = request.permission === 'doom_loop'
  const meta = summarizeMetadata(request.metadata)
  const patterns = request.patterns.filter(Boolean)

  return (
    <div
      className={`permission-ask${isDoom ? ' permission-ask-doom' : ''}`}
      role="alertdialog"
      aria-labelledby="permission-ask-title"
      aria-describedby="permission-ask-body"
    >
      <div className="permission-ask-copy">
        <h3 id="permission-ask-title">
          {isDoom ? 'Agent appears stuck' : `Allow “${request.permission}”?`}
        </h3>
        <p id="permission-ask-body">
          {isDoom
            ? 'The same tool call repeated several times. Continue once, always allow this session, or stop.'
            : 'The agent needs permission before continuing.'}
        </p>
        {patterns.length > 0 ? (
          <ul className="permission-ask-patterns">
            {patterns.map((pattern) => (
              <li key={pattern}>
                <code>{pattern}</code>
              </li>
            ))}
          </ul>
        ) : null}
        {meta ? <p className="permission-ask-meta">{meta}</p> : null}
      </div>
      <div className="permission-ask-actions">
        <button
          type="button"
          className="permission-ask-btn permission-ask-once"
          disabled={busy}
          onClick={() => onReply('once')}
        >
          {isDoom ? 'Continue once' : 'Once'}
        </button>
        <button
          type="button"
          className="permission-ask-btn permission-ask-always"
          disabled={busy}
          onClick={() => onReply('always')}
        >
          Always
        </button>
        <button
          type="button"
          className="permission-ask-btn permission-ask-reject"
          disabled={busy}
          onClick={() => onReply('reject')}
        >
          {isDoom ? 'Stop' : 'Reject'}
        </button>
      </div>
    </div>
  )
}
