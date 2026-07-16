import { describe, expect, it } from 'vitest'
import type { AssistantMessageSegment, PartRecord, StreamEvent } from '@browser-agent/core'
import {
  assistantSegmentsText,
  reduceAssistantSegments,
  transcriptToMessages,
} from './assistant-message.js'

function reduce(events: StreamEvent[]): AssistantMessageSegment[] {
  return events.reduce(reduceAssistantSegments, [] as AssistantMessageSegment[])
}

function part(id: string, type: PartRecord['type'], content: unknown, order: number): PartRecord {
  return {
    id,
    messageId: 'message-1',
    type,
    content,
    createdAt: 100,
    order,
  }
}

describe('reduceAssistantSegments', () => {
  it('keeps text → tool → text in chronological order', () => {
    const segments = reduce([
      { kind: 'segment-start', segmentId: 'text-1', segmentType: 'text' },
      { kind: 'text-delta', segmentId: 'text-1', text: 'Before' },
      { kind: 'segment-end', segmentId: 'text-1', segmentType: 'text' },
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        toolName: 'page_read',
        args: { tabId: 1 },
      },
      { kind: 'segment-start', segmentId: 'text-2', segmentType: 'text' },
      { kind: 'text-delta', segmentId: 'text-2', text: 'After' },
      { kind: 'segment-end', segmentId: 'text-2', segmentType: 'text' },
    ])

    expect(segments.map((segment) => segment.type)).toEqual(['text', 'tool', 'text'])
    expect(assistantSegmentsText(segments)).toBe('BeforeAfter')
  })

  it('keeps text → reasoning → text ordered for legacy events without starts', () => {
    const segments = reduce([
      { kind: 'text-delta', text: 'Answer' },
      { kind: 'reasoning-delta', text: 'Check' },
      { kind: 'text-delta', text: 'Result' },
      { kind: 'done' },
    ])

    expect(segments).toMatchObject([
      { type: 'text', content: 'Answer', status: 'complete' },
      { type: 'reasoning', content: 'Check', status: 'complete' },
      { type: 'text', content: 'Result', status: 'complete' },
    ])
  })

  it('uses step boundaries to prevent adjacent steps from merging', () => {
    const segments = reduce([
      { kind: 'step-start', stepId: 'step-1' },
      { kind: 'text-delta', text: 'one' },
      { kind: 'step-end', stepId: 'step-1', finishReason: 'tool-calls' },
      { kind: 'step-start', stepId: 'step-2' },
      { kind: 'text-delta', text: 'two' },
      { kind: 'step-end', stepId: 'step-2', finishReason: 'stop' },
    ])

    expect(segments).toMatchObject([
      { type: 'text', content: 'one', status: 'complete' },
      { type: 'text', content: 'two', status: 'complete' },
    ])
  })

  it('updates a matching tool result without moving its segment', () => {
    const segments = reduce([
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        toolName: 'navigate',
        args: { url: 'https://example.com' },
      },
      { kind: 'text-delta', segmentId: 'text-1', text: 'Waiting' },
      {
        kind: 'tool-result',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        result: { ok: true },
      },
    ])

    expect(segments.map((segment) => segment.id)).toEqual(['tool-1', 'text-1'])
    expect(segments[0]).toMatchObject({
      type: 'tool',
      status: 'done',
      result: { ok: true },
    })
  })

  it('marks failed tools as error status', () => {
    const segments = reduce([
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        toolName: 'page_screenshot',
        args: {},
      },
      {
        kind: 'tool-result',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        result: { error: 'permission required' },
        isError: true,
      },
    ])

    expect(segments[0]).toMatchObject({
      type: 'tool',
      status: 'error',
      result: { error: 'permission required' },
    })
  })

  it('treats compaction events as status metadata, not assistant content', () => {
    const before = reduce([{ kind: 'text-delta', segmentId: 'text-1', text: 'Answer' }])
    const after = reduceAssistantSegments(before, {
      kind: 'compaction',
      status: 'completed',
      message: 'Compacted older turns.',
      epoch: 2,
    })

    expect(after).toEqual(before)
    expect(assistantSegmentsText(after)).toBe('Answer')
  })
})

describe('transcriptToMessages', () => {
  it('reconstructs the same segments as the live stream in PartRecord order', () => {
    const events: StreamEvent[] = [
      { kind: 'segment-start', segmentId: 'text-1', segmentType: 'text' },
      { kind: 'text-delta', segmentId: 'text-1', text: 'Before' },
      { kind: 'segment-end', segmentId: 'text-1', segmentType: 'text' },
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        toolName: 'page_read',
        args: {},
      },
      {
        kind: 'tool-result',
        segmentId: 'tool-1',
        toolCallId: 'call-1',
        result: 'read',
      },
      { kind: 'segment-start', segmentId: 'reasoning-1', segmentType: 'reasoning' },
      { kind: 'reasoning-delta', segmentId: 'reasoning-1', text: 'Consider' },
      { kind: 'segment-end', segmentId: 'reasoning-1', segmentType: 'reasoning' },
      { kind: 'segment-start', segmentId: 'text-2', segmentType: 'text' },
      { kind: 'text-delta', segmentId: 'text-2', text: 'After' },
      { kind: 'segment-end', segmentId: 'text-2', segmentType: 'text' },
    ]
    const live = reduce(events)
    const [reloaded] = transcriptToMessages([
      {
        id: 'message-1',
        role: 'assistant',
        parts: [
          part('text-1', 'text', 'Before', 0),
          part('tool-1', 'tool-call', { toolCallId: 'call-1', toolName: 'page_read', args: {} }, 1),
          part(
            'result-1',
            'tool-result',
            { toolCallId: 'call-1', segmentId: 'tool-1', result: 'read' },
            2,
          ),
          part('reasoning-1', 'reasoning', 'Consider', 3),
          part('text-2', 'text', 'After', 4),
        ],
      },
    ])

    expect(reloaded?.segments).toEqual(live)
  })

  it('loads old records without segment metadata and preserves supplied order', () => {
    const [message] = transcriptToMessages([
      {
        id: 'old-message',
        role: 'assistant',
        parts: [
          part('old-text-1', 'text', 'A', 2),
          part('old-tool', 'tool-call', { toolCallId: 'old-call', toolName: 'click', args: {} }, 0),
          part('old-result', 'tool-result', { toolCallId: 'old-call', result: 'ok' }, 1),
          part('old-text-2', 'text', 'B', 3),
        ],
      },
    ])

    expect(message?.segments?.map((segment) => segment.type)).toEqual(['text', 'tool', 'text'])
    expect(message?.segments?.[1]).toMatchObject({ status: 'done', result: 'ok' })
  })

  it('keeps a plain assistant response as one compatible text segment', () => {
    const [message] = transcriptToMessages([
      {
        id: 'plain',
        role: 'assistant',
        parts: [part('plain-text', 'text', 'Hello world', 0)],
      },
    ])

    expect(message).toMatchObject({
      role: 'assistant',
      content: 'Hello world',
      segments: [
        {
          id: 'plain-text',
          type: 'text',
          content: 'Hello world',
          status: 'complete',
        },
      ],
    })
  })
})
