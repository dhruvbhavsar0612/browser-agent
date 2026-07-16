import { useId, useState } from 'react'

export type ToolStreamEvent =
  | { kind: 'tool-call'; toolCallId: string; toolName: string; args?: unknown }
  | { kind: 'tool-result'; toolCallId: string; result?: unknown }

export type ToolGroup = {
  toolCallId: string
  toolName: string
  args?: unknown
  result?: unknown
  status: 'pending' | 'done' | 'error'
}

function formatJson(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function ToolRow({ tool }: { tool: ToolGroup }) {
  const [expanded, setExpanded] = useState(false)
  const panelId = useId()
  const hasDetails = tool.args != null || tool.result != null

  return (
    <div className="tool-row">
      <button
        type="button"
        className="tool-toggle"
        aria-expanded={expanded}
        aria-controls={hasDetails ? panelId : undefined}
        disabled={!hasDetails}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="tool-chevron" aria-hidden="true">
          ▶
        </span>
        <span className="tool-name">{tool.toolName}</span>
        <span className={`tool-status tool-status-${tool.status}`}>
          {tool.status === 'pending' ? 'Running' : tool.status === 'error' ? 'Error' : 'Done'}
        </span>
      </button>
      {expanded && hasDetails ? (
        <div id={panelId} className="tool-details">
          {tool.args != null ? (
            <div className="tool-detail-block">
              <span className="tool-detail-label">Arguments</span>
              <pre className="tool-detail-code">{formatJson(tool.args)}</pre>
            </div>
          ) : null}
          {tool.result != null ? (
            <div className="tool-detail-block">
              <span className="tool-detail-label">Result</span>
              <pre className="tool-detail-code">{formatJson(tool.result)}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

export function ToolInspector({ tools }: { tools: ToolGroup[] }) {
  if (tools.length === 0) return null

  return (
    <div className="tool-list" role="list">
      {tools.map((tool) => (
        <ToolRow key={tool.toolCallId} tool={tool} />
      ))}
    </div>
  )
}

export function groupToolEvents(events: ToolStreamEvent[]): ToolGroup[] {
  const map = new Map<string, ToolGroup>()

  for (const event of events) {
    if (event.kind === 'tool-call') {
      const existing = map.get(event.toolCallId)
      map.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        result: existing?.result,
        status: existing?.result != null ? 'done' : 'pending',
      })
    } else {
      const existing = map.get(event.toolCallId)
      map.set(event.toolCallId, {
        toolCallId: event.toolCallId,
        toolName: existing?.toolName ?? 'tool',
        args: existing?.args,
        result: event.result,
        status: 'done',
      })
    }
  }

  return [...map.values()]
}
