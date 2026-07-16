import { describe, expect, it, vi } from 'vitest'
import type { TextStreamPart, ToolSet } from 'ai'
import type { StreamEvent } from '../messaging/index.js'
import {
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  REDACTED_THINK_CLOSE,
  REDACTED_THINK_OPEN,
  THINK_CLOSE,
  THINK_OPEN,
  ThinkTagParser,
  processFullStream,
  truncateToolResultDefault,
  type DurablePart,
} from './processor.js'

async function* fixtureStream(parts: TextStreamPart<ToolSet>[]) {
  for (const part of parts) {
    yield part
  }
}

function collect(
  parts: TextStreamPart<ToolSet>[],
  opts?: Omit<Parameters<typeof processFullStream>[1], 'onEvent' | 'onPart'>,
) {
  const events: StreamEvent[] = []
  const durable: DurablePart[] = []
  let segmentSequence = 0
  return processFullStream(fixtureStream(parts), {
    onEvent: (event) => events.push(event),
    onPart: (part) => {
      durable.push(part)
    },
    createSegmentId: (type) => `${type}-${++segmentSequence}`,
    ...opts,
  }).then((result) => ({ events, durable, result }))
}

describe('processFullStream', () => {
  it('maps text deltas and flushes durable text on text-end', async () => {
    const { events, durable } = await collect([
      { type: 'text-start', id: 't1' },
      { type: 'text-delta', id: 't1', text: 'Hello' },
      { type: 'text-delta', id: 't1', text: ' world' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.filter((e) => e.kind === 'text-delta').map((e) => e.text)).toEqual([
      'Hello',
      ' world',
    ])
    expect(durable).toEqual([{ id: 'text-1', type: 'text', content: 'Hello world' }])
  })

  it('maps reasoning deltas as reasoning-delta events and persists reasoning parts', async () => {
    const { events, durable } = await collect([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', text: 'think' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events).toEqual([
      { kind: 'segment-start', segmentId: 'reasoning-1', segmentType: 'reasoning' },
      { kind: 'reasoning-delta', segmentId: 'reasoning-1', text: 'think' },
      { kind: 'segment-end', segmentId: 'reasoning-1', segmentType: 'reasoning' },
    ])
    expect(durable).toEqual([{ id: 'reasoning-1', type: 'reasoning', content: 'think' }])
  })

  it('maps tool-call and tool-result events with durable parts', async () => {
    const { events, durable } = await collect([
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'echo',
        input: { text: 'hi' },
        dynamic: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'echo',
        input: { text: 'hi' },
        output: { echoed: 'hi' },
        dynamic: true,
      },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        rawFinishReason: 'tool-calls',
        totalUsage: {} as never,
      },
    ])

    expect(events).toEqual([
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'c1',
        toolName: 'echo',
        args: { text: 'hi' },
      },
      {
        kind: 'tool-result',
        segmentId: 'tool-1',
        toolCallId: 'c1',
        result: { echoed: 'hi' },
      },
    ])
    expect(durable).toEqual([
      {
        id: 'tool-1',
        type: 'tool-call',
        content: { toolCallId: 'c1', toolName: 'echo', args: { text: 'hi' } },
      },
      {
        type: 'tool-result',
        content: {
          toolCallId: 'c1',
          segmentId: 'tool-1',
          result: { echoed: 'hi' },
        },
      },
    ])
  })

  it('emits an early pending tool-call on tool-input-start', async () => {
    const { events, durable } = await collect([
      {
        type: 'tool-input-start',
        id: 'c1',
        toolName: 'page_screenshot',
      },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'page_screenshot',
        input: { format: 'jpeg' },
        dynamic: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'page_screenshot',
        input: { format: 'jpeg' },
        output: { ok: true },
        dynamic: true,
      },
      {
        type: 'finish',
        finishReason: 'tool-calls',
        rawFinishReason: 'tool-calls',
        totalUsage: {} as never,
      },
    ])

    expect(events.filter((event) => event.kind === 'tool-call')).toEqual([
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'c1',
        toolName: 'page_screenshot',
        args: undefined,
      },
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 'c1',
        toolName: 'page_screenshot',
        args: { format: 'jpeg' },
      },
    ])
    expect(durable).toHaveLength(2)
    expect(durable[0]).toMatchObject({
      id: 'tool-1',
      type: 'tool-call',
      content: { toolCallId: 'c1', toolName: 'page_screenshot', args: { format: 'jpeg' } },
    })
  })

  it('marks tool-error results with isError for the UI', async () => {
    const { events } = await collect([
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'page_screenshot',
        input: {},
        dynamic: true,
      },
      {
        type: 'tool-error',
        toolCallId: 'c1',
        toolName: 'page_screenshot',
        input: {},
        error: new Error("Either the '<all_urls>' or 'activeTab' permission is required."),
        dynamic: true,
      },
      {
        type: 'finish',
        finishReason: 'stop',
        rawFinishReason: 'stop',
        totalUsage: {} as never,
      },
    ])

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'tool-result',
          toolCallId: 'c1',
          isError: true,
          result: {
            error: "Either the '<all_urls>' or 'activeTab' permission is required.",
          },
        }),
        expect.objectContaining({
          kind: 'error',
          message: "Either the '<all_urls>' or 'activeTab' permission is required.",
        }),
      ]),
    )
  })

  it('preserves text → tool → text chronology in events and durable parts', async () => {
    const { events, durable } = await collect([
      { type: 'text-delta', id: 't1', text: 'Before' },
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'echo',
        input: { text: 'hi' },
        dynamic: true,
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'echo',
        input: { text: 'hi' },
        output: 'ok',
        dynamic: true,
      },
      { type: 'text-delta', id: 't2', text: 'After' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.map((event) => event.kind)).toEqual([
      'segment-start',
      'text-delta',
      'segment-end',
      'tool-call',
      'tool-result',
      'segment-start',
      'text-delta',
      'segment-end',
    ])
    expect(durable.map((part) => part.type)).toEqual(['text', 'tool-call', 'tool-result', 'text'])
    expect(durable.map((part) => part.content)).toEqual([
      'Before',
      { toolCallId: 'c1', toolName: 'echo', args: { text: 'hi' } },
      { toolCallId: 'c1', segmentId: 'tool-2', result: 'ok' },
      'After',
    ])
  })

  it('emits step boundaries and closes content when start events are omitted', async () => {
    const startStep = {
      type: 'start-step' as const,
      request: {} as never,
      warnings: [],
    }
    const finishStep = {
      type: 'finish-step' as const,
      response: {} as never,
      usage: {} as never,
      finishReason: 'tool-calls' as const,
      rawFinishReason: 'tool-calls',
      providerMetadata: undefined,
    }
    const { events, durable } = await collect([
      startStep,
      { type: 'text-delta', id: 't1', text: 'step one' },
      finishStep,
      startStep,
      { type: 'reasoning-delta', id: 'r1', text: 'step two' },
      { ...finishStep, finishReason: 'stop' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.map((event) => event.kind)).toEqual([
      'step-start',
      'segment-start',
      'text-delta',
      'segment-end',
      'step-end',
      'step-start',
      'segment-start',
      'reasoning-delta',
      'segment-end',
      'step-end',
    ])
    expect(durable).toEqual([
      { id: 'text-2', type: 'text', content: 'step one' },
      { id: 'reasoning-4', type: 'reasoning', content: 'step two' },
    ])
  })

  it('uses delta source IDs as boundaries when providers omit start/end events', async () => {
    const { events, durable } = await collect([
      { type: 'text-delta', id: 'provider-text-1', text: 'first' },
      { type: 'text-delta', id: 'provider-text-2', text: 'second' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.map((event) => event.kind)).toEqual([
      'segment-start',
      'text-delta',
      'segment-end',
      'segment-start',
      'text-delta',
      'segment-end',
    ])
    expect(durable).toEqual([
      { id: 'text-1', type: 'text', content: 'first' },
      { id: 'text-2', type: 'text', content: 'second' },
    ])
  })

  it('truncates oversized tool results', async () => {
    const big = 'x'.repeat(DEFAULT_TOOL_RESULT_MAX_CHARS + 100)
    const { events } = await collect([
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'echo',
        input: {},
        output: big,
        dynamic: true,
      },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    const result = events.find((e) => e.kind === 'tool-result')
    expect(result?.result).toContain('[truncated')
    expect(String(result?.result).length).toBeLessThan(big.length)
  })

  it('truncateToolResultDefault handles non-string values', () => {
    const bigObj = { data: 'y'.repeat(DEFAULT_TOOL_RESULT_MAX_CHARS + 50) }
    const truncated = truncateToolResultDefault(bigObj) as { truncated: boolean }
    expect(truncated.truncated).toBe(true)
  })

  it('maps tool-error and stream error to error events', async () => {
    const toolErr = await collect([
      {
        type: 'tool-error',
        toolCallId: 'c1',
        toolName: 'echo',
        input: {},
        error: new Error('boom'),
        dynamic: true,
      },
      { type: 'finish', finishReason: 'error', rawFinishReason: 'error', totalUsage: {} as never },
    ])
    expect(toolErr.events).toContainEqual({ kind: 'error', message: 'boom' })

    const streamErr = await collect([{ type: 'error', error: new Error('stream failed') }])
    expect(streamErr.events).toContainEqual({ kind: 'error', message: 'stream failed' })
    expect(streamErr.result.stopped).toBe(true)
  })

  it('returns finishReason from finish event', async () => {
    const { result } = await collect([
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])
    expect(result.finishReason).toBe('stop')
  })

  it('detects doom loop after threshold identical tool calls', async () => {
    const onDetect = vi.fn(async () => 'stop' as const)
    const toolCall = {
      type: 'tool-call' as const,
      toolCallId: 'c1',
      toolName: 'echo',
      input: { text: 'loop' },
      dynamic: true as const,
    }

    const { events, result } = await collect(
      [toolCall, { ...toolCall, toolCallId: 'c2' }, { ...toolCall, toolCallId: 'c3' }],
      {
        doomLoop: { threshold: 3, onDetect },
      },
    )

    expect(onDetect).toHaveBeenCalledOnce()
    expect(result.stopped).toBe(true)
  })

  it('continues after doom loop when onDetect returns continue', async () => {
    const onDetect = vi.fn(async () => 'continue' as const)
    const toolCall = {
      type: 'tool-call' as const,
      toolCallId: 'c1',
      toolName: 'echo',
      input: { text: 'loop' },
      dynamic: true as const,
    }

    const { result } = await collect(
      [
        toolCall,
        { ...toolCall, toolCallId: 'c2' },
        { ...toolCall, toolCallId: 'c3' },
        { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
      ],
      { doomLoop: { threshold: 3, onDetect } },
    )

    expect(onDetect).toHaveBeenCalledOnce()
    expect(result.stopped).toBe(false)
    expect(result.finishReason).toBe('stop')
  })

  it('stops when abortSignal is set', async () => {
    const controller = new AbortController()
    controller.abort()

    const { result } = await collect([{ type: 'text-delta', id: 't1', text: 'nope' }], {
      abortSignal: controller.signal,
    })

    expect(result.stopped).toBe(true)
  })

  it('strips <think> tags from text into reasoning-delta', async () => {
    const { events } = await collect([
      {
        type: 'text-delta',
        id: 't1',
        text: `Hello ${THINK_OPEN}secret plan${THINK_CLOSE} world`,
      },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.filter((event) => event.kind.endsWith('-delta'))).toEqual([
      { kind: 'text-delta', segmentId: 'text-1', text: 'Hello ' },
      { kind: 'reasoning-delta', segmentId: 'reasoning-2', text: 'secret plan' },
      { kind: 'text-delta', segmentId: 'text-3', text: ' world' },
    ])
    expect(events.map((event) => event.kind)).toEqual([
      'segment-start',
      'text-delta',
      'segment-end',
      'segment-start',
      'reasoning-delta',
      'segment-end',
      'segment-start',
      'text-delta',
      'segment-end',
    ])
  })

  it('strips redacted_thinking tags from text into reasoning-delta', async () => {
    const { events } = await collect([
      {
        type: 'text-delta',
        id: 't1',
        text: `Hello ${REDACTED_THINK_OPEN}secret plan${REDACTED_THINK_CLOSE} world`,
      },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.filter((event) => event.kind.endsWith('-delta'))).toEqual([
      { kind: 'text-delta', segmentId: 'text-1', text: 'Hello ' },
      { kind: 'reasoning-delta', segmentId: 'reasoning-2', text: 'secret plan' },
      { kind: 'text-delta', segmentId: 'text-3', text: ' world' },
    ])
  })

  it('handles think tags split across text deltas', async () => {
    const partialOpen = THINK_OPEN.slice(0, -1)
    const { events } = await collect([
      { type: 'text-delta', id: 't1', text: `A ${partialOpen}` },
      { type: 'text-delta', id: 't1', text: `${THINK_OPEN.slice(-1)}inner${THINK_CLOSE} B` },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events.filter((event) => event.kind.endsWith('-delta'))).toEqual([
      { kind: 'text-delta', segmentId: 'text-1', text: 'A ' },
      { kind: 'reasoning-delta', segmentId: 'reasoning-2', text: 'inner' },
      { kind: 'text-delta', segmentId: 'text-3', text: ' B' },
    ])
  })

  it('never emits think tags in text output', async () => {
    const { events } = await collect([
      { type: 'text-delta', id: 't1', text: `${THINK_OPEN}only think${THINK_CLOSE}` },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    const textEvents = events.filter((e) => e.kind === 'text-delta')
    expect(textEvents).toHaveLength(0)
    expect(events).toContainEqual({
      kind: 'reasoning-delta',
      segmentId: 'reasoning-1',
      text: 'only think',
    })
  })
})

describe('ThinkTagParser', () => {
  it('parses partial closing tags at chunk boundaries', () => {
    const events: Array<{ kind: 'text' | 'reasoning'; text: string }> = []
    const parser = new ThinkTagParser()
    const emit = {
      text: (text: string) => events.push({ kind: 'text', text }),
      reasoning: (text: string) => events.push({ kind: 'reasoning', text }),
    }

    parser.process(`${THINK_OPEN}x`, emit)
    const partialClose = THINK_CLOSE.slice(0, -1)
    parser.process(`${partialClose}`, emit)
    parser.process(`${THINK_CLOSE.slice(-1)}y`, emit)
    parser.flush(emit)

    expect(events).toEqual([
      { kind: 'reasoning', text: 'x' },
      { kind: 'text', text: 'y' },
    ])
  })

  it('parses redacted_thinking partial closing tags', () => {
    const events: Array<{ kind: 'text' | 'reasoning'; text: string }> = []
    const parser = new ThinkTagParser()
    const emit = {
      text: (text: string) => events.push({ kind: 'text', text }),
      reasoning: (text: string) => events.push({ kind: 'reasoning', text }),
    }

    parser.process(`${REDACTED_THINK_OPEN}x`, emit)
    const partialClose = REDACTED_THINK_CLOSE.slice(0, -1)
    parser.process(`${partialClose}`, emit)
    parser.process(`${REDACTED_THINK_CLOSE.slice(-1)}y`, emit)
    parser.flush(emit)

    expect(events).toEqual([
      { kind: 'reasoning', text: 'x' },
      { kind: 'text', text: 'y' },
    ])
  })
})
