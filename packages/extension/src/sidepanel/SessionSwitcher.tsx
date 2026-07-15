import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { SessionRecord } from '@browser-agent/core'
import './SessionSwitcher.css'

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return 'Just now'
  if (delta < hour) return `${Math.floor(delta / minute)}m ago`
  if (delta < day) return `${Math.floor(delta / hour)}h ago`
  if (delta < 7 * day) return `${Math.floor(delta / day)}d ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export type SessionSwitcherProps = {
  sessions: SessionRecord[]
  activeSessionId: string | null
  activeTitle: string
  onSelect: (sessionId: string) => void
  onNewChat: () => void
  onDelete: (sessionId: string) => void
}

export function SessionSwitcher({
  sessions,
  activeSessionId,
  activeTitle,
  onSelect,
  onNewChat,
  onDelete,
}: SessionSwitcherProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const listId = useId()

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = useCallback(() => setOpen((value) => !value), [])

  return (
    <div className="session-switcher" ref={rootRef}>
      <button
        type="button"
        className="session-switcher-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={toggle}
        title={activeTitle}
      >
        <span className="session-switcher-title">{activeTitle}</span>
        <span className="session-switcher-chevron" aria-hidden="true">
          ▾
        </span>
      </button>

      {open ? (
        <div className="session-switcher-menu" role="listbox" id={listId}>
          <button
            type="button"
            className="session-switcher-item session-switcher-new"
            role="option"
            onClick={() => {
              setOpen(false)
              onNewChat()
            }}
          >
            New chat
          </button>

          {sessions.length === 0 ? (
            <div className="session-switcher-empty">No past chats yet</div>
          ) : (
            <ul className="session-switcher-list">
              {sessions.map((session) => {
                const active = session.id === activeSessionId
                return (
                  <li key={session.id} className="session-switcher-row">
                    <button
                      type="button"
                      className={`session-switcher-item${active ? ' active' : ''}`}
                      role="option"
                      aria-selected={active}
                      onClick={() => {
                        setOpen(false)
                        onSelect(session.id)
                      }}
                    >
                      <span className="session-switcher-item-title">{session.title}</span>
                      <span className="session-switcher-item-meta">
                        {formatRelativeTime(session.updatedAt)}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="session-switcher-delete"
                      aria-label={`Delete ${session.title}`}
                      title="Delete"
                      onClick={(event) => {
                        event.stopPropagation()
                        onDelete(session.id)
                      }}
                    >
                      ×
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
