import { useId, useState } from 'react'

export function ThinkingDisclosure({
  content,
  isLive,
}: {
  content: string
  isLive?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()

  if (!content && !isLive) return null

  const label = isLive ? 'Thinking…' : 'Thinking'

  return (
    <div className={`thinking-disclosure${isLive ? ' thinking-live' : ''}`}>
      <button
        type="button"
        className="thinking-toggle"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="thinking-chevron" aria-hidden="true">
          ▶
        </span>
        {label}
      </button>
      {expanded ? (
        <div id={panelId} className="thinking-body">
          {content || '…'}
        </div>
      ) : null}
    </div>
  )
}
