import { describe, expect, it } from 'vitest'
import type { UiMessage } from './assistant-message.js'
import {
  applyConnectionStatusToRun,
  applyStreamEventToRun,
  isFatalStreamEvent,
  reconcileLiveMessages,
  type ChatRunState,
} from './chat-stream.js'

const running: ChatRunState = {
  streaming: true,
  requestId: 'req-1',
  error: null,
}

describe('applyStreamEventToRun', () => {
  it('ignores events for a different or cleared request', () => {
    expect(
      applyStreamEventToRun(running, { kind: 'text-delta', text: 'hi' }, 'other'),
    ).toEqual(running)
    expect(
      applyStreamEventToRun(
        { ...running, requestId: null },
        { kind: 'text-delta', text: 'hi' },
        'req-1',
      ),
    ).toEqual({ ...running, requestId: null })
  })

  it('keeps the run alive after a tool error result so later events apply', () => {
    const next = applyStreamEventToRun(
      running,
      {
        kind: 'tool-result',
        toolCallId: 'c1',
        result: { error: "ref_id 'ref_243' has no visible bounding box" },
        isError: true,
      },
      'req-1',
    )
    expect(next).toEqual(running)
    expect(isFatalStreamEvent({ kind: 'tool-result', toolCallId: 'c1', isError: true })).toBe(
      false,
    )
  })

  it('stops the UI only on fatal stream errors', () => {
    expect(isFatalStreamEvent({ kind: 'error', message: 'No model selected' })).toBe(true)
    expect(
      applyStreamEventToRun(running, { kind: 'error', message: 'No model selected' }, 'req-1'),
    ).toEqual({
      streaming: false,
      requestId: null,
      error: 'No model selected',
    })
  })

  it('clears the request id when the agent is actually done', () => {
    expect(applyStreamEventToRun(running, { kind: 'done' }, 'req-1')).toEqual({
      streaming: false,
      requestId: null,
      error: null,
    })
  })
})

describe('applyConnectionStatusToRun', () => {
  it('does not drop the active request while reconnecting', () => {
    const next = applyConnectionStatusToRun(running, 'disconnected')
    expect(next.requestId).toBe('req-1')
    expect(next.streaming).toBe(true)
    expect(next.error).toMatch(/Reconnecting/)
  })

  it('clears the transient disconnect banner after reconnect', () => {
    const disconnected = applyConnectionStatusToRun(running, 'disconnected')
    expect(applyConnectionStatusToRun(disconnected, 'connected')).toEqual(running)
  })

  it('leaves a genuine fatal error in place after reconnect', () => {
    const fatal: ChatRunState = {
      streaming: false,
      requestId: null,
      error: 'No model selected',
    }
    expect(applyConnectionStatusToRun(fatal, 'connected')).toEqual(fatal)
  })
})

describe('reconcileLiveMessages', () => {
  it('fills in tool results persisted while the UI was disconnected', () => {
    const live: UiMessage[] = [
      { id: 'u1', role: 'user', content: 'click California' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        segments: [
          {
            id: 'tool-1',
            type: 'tool',
            toolCallId: 'c1',
            toolName: 'click',
            args: { refId: 'ref_243' },
            status: 'pending',
          },
        ],
      },
    ]
    const persisted: UiMessage[] = [
      { id: 'u1', role: 'user', content: 'click California' },
      {
        id: 'a1',
        role: 'assistant',
        content: '',
        segments: [
          {
            id: 'tool-1',
            type: 'tool',
            toolCallId: 'c1',
            toolName: 'click',
            args: { refId: 'ref_243' },
            result: { error: "ref_id 'ref_243' has no visible bounding box" },
            status: 'error',
          },
          {
            id: 'text-2',
            type: 'text',
            content: 'Retrying with page_read',
            status: 'complete',
          },
        ],
      },
    ]

    const merged = reconcileLiveMessages(live, persisted)
    expect(merged[1]?.segments).toMatchObject([
      { toolCallId: 'c1', status: 'error' },
      { id: 'text-2', content: 'Retrying with page_read' },
    ])
  })

  it('does not duplicate segments that are already live', () => {
    const live: UiMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'Hello',
        segments: [{ id: 'text-1', type: 'text', content: 'Hello', status: 'complete' }],
      },
    ]
    expect(reconcileLiveMessages(live, live)).toEqual(live)
  })
})
