import type { AssistantMessageSegment, StreamEvent } from '@browser-agent/core'
import type { UiMessage } from './assistant-message.js'

export type ChatRunState = {
  streaming: boolean
  requestId: string | null
  error: string | null
}

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnecting'

const TRANSIENT_CONNECTION_ERROR = /^Connection interrupted|^Stream connection unavailable/

/** Fatal stream events end the UI run. Tool failures are `tool-result` with isError. */
export function isFatalStreamEvent(event: StreamEvent): boolean {
  return event.kind === 'error'
}

export function applyStreamEventToRun(
  state: ChatRunState,
  event: StreamEvent,
  envelopeId: string,
): ChatRunState {
  if (!state.requestId || envelopeId !== state.requestId) return state

  if (event.kind === 'error') {
    return { streaming: false, requestId: null, error: event.message }
  }
  if (event.kind === 'done') {
    return { streaming: false, requestId: null, error: state.error }
  }
  return state
}

/**
 * Keep listening after a transient disconnect so later events from the still-running
 * agent are applied. The connection banner already surfaces reconnect state.
 */
export function applyConnectionStatusToRun(
  state: ChatRunState,
  status: ConnectionStatus,
): ChatRunState {
  if (status === 'disconnected' && state.streaming) {
    return {
      ...state,
      error: 'Connection interrupted. Reconnecting… later events will still appear.',
    }
  }
  if (status === 'connected' && state.error && TRANSIENT_CONNECTION_ERROR.test(state.error)) {
    return { ...state, error: null }
  }
  return state
}

function toolKey(segment: AssistantMessageSegment): string | null {
  return segment.type === 'tool' ? segment.toolCallId : null
}

function indexToolResults(messages: UiMessage[]): Map<string, AssistantMessageSegment> {
  const results = new Map<string, AssistantMessageSegment>()
  for (const message of messages) {
    for (const segment of message.segments ?? []) {
      if (segment.type !== 'tool') continue
      if (segment.status === 'done' || segment.status === 'error') {
        results.set(segment.toolCallId, segment)
      }
    }
  }
  return results
}

function indexSegments(messages: UiMessage[]): Map<string, AssistantMessageSegment> {
  const map = new Map<string, AssistantMessageSegment>()
  for (const message of messages) {
    for (const segment of message.segments ?? []) {
      map.set(segment.id, segment)
      const key = toolKey(segment)
      if (key) map.set(`tool:${key}`, segment)
    }
  }
  return map
}

/**
 * Fill in tool results (and any segments) persisted while the UI was disconnected,
 * without duplicating live text that is already on screen.
 */
export function reconcileLiveMessages(live: UiMessage[], persisted: UiMessage[]): UiMessage[] {
  if (persisted.length === 0) return live
  if (live.length === 0) return persisted

  const persistedTools = indexToolResults(persisted)
  const liveSegments = indexSegments(live)
  const persistedById = new Map(persisted.map((message) => [message.id, message]))

  const merged = live.map((message) => {
    const persistedMessage = persistedById.get(message.id)
    if (message.role !== 'assistant') return message

    const liveSegs = message.segments ?? []
    const nextSegments = liveSegs.map((segment) => {
      if (segment.type !== 'tool' || segment.status !== 'pending') return segment
      const found = persistedTools.get(segment.toolCallId)
      if (!found || found.type !== 'tool') return segment
      return { ...segment, result: found.result, status: found.status }
    })

    const extras =
      persistedMessage?.segments?.filter((segment) => {
        if (liveSegments.has(segment.id)) return false
        if (segment.type === 'tool' && liveSegments.has(`tool:${segment.toolCallId}`)) return false
        return true
      }) ?? []

    if (extras.length === 0 && nextSegments.every((segment, index) => segment === liveSegs[index])) {
      return message
    }

    return { ...message, segments: [...nextSegments, ...extras] }
  })

  const liveIds = new Set(live.map((message) => message.id))
  const missing = persisted.filter((message) => !liveIds.has(message.id))
  if (missing.length === 0) return merged
  return [...merged, ...missing]
}
