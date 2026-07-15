import { describe, expect, it, vi } from 'vitest'
import type { TextStreamPart, ToolSet } from 'ai'
import type { StreamEvent } from '../messaging/index.js'
import {
  DEFAULT_TOOL_RESULT_MAX_CHARS,
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
  return processFullStream(fixtureStream(parts), {
    onEvent: (event) => events.push(event),
    onPart: (part) => durable.push(part),
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
    expect(durable).toEqual([{ type: 'text', content: 'Hello world' }])
  })

  it('maps reasoning deltas as reasoning-delta events and persists reasoning parts', async () => {
    const { events, durable } = await collect([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', text: 'think' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events).toEqual([{ kind: 'reasoning-delta', text: 'think' }])
    expect(durable).toEqual([{ type: 'reasoning', content: 'think' }])
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
      { type: 'finish', finishReason: 'tool-calls', rawFinishReason: 'tool-calls', totalUsage: {} as never },
    ])

    expect(events).toEqual([
      {
        kind: 'tool-call',
        toolCallId: 'c1',
        toolName: 'echo',
        args: { text: 'hi' },
      },
      {
        kind: 'tool-result',
        toolCallId: 'c1',
        result: { echoed: 'hi' },
      },
    ])
    expect(durable).toEqual([
      {
        type: 'tool-call',
        content: { toolCallId: 'c1', toolName: 'echo', args: { text: 'hi' } },
      },
      {
        type: 'tool-result',
        content: { toolCallId: 'c1', result: { echoed: 'hi' } },
      },
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

    const streamErr = await collect([
      { type: 'error', error: new Error('stream failed') },
    ])
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
    expect(events.some((e) => e.kind === 'permission-ask' && e.permission === 'doom_loop')).toBe(
      true,
    )
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

    const { result } = await collect(
      [{ type: 'text-delta', id: 't1', text: 'nope' }],
      { abortSignal: controller.signal },
    )

    expect(result.stopped).toBe(true)
  })

  it('strips redacted_thinking tags from text into reasoning-delta', async () => {
    const { events } = await collect([
      {
        type: 'text-delta',
        id: 't1',
        text: `Hello ${THINK_OPEN}secret plan${THINK_CLOSE} world`,
      },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events).toEqual([
      { kind: 'text-delta', text: 'Hello ' },
      { kind: 'reasoning-delta', text: 'secret plan' },
      { kind: 'text-delta', text: ' world' },
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

    expect(events).toEqual([
      { kind: 'text-delta', text: 'A ' },
      { kind: 'reasoning-delta', text: 'inner' },
      { kind: 'text-delta', text: ' B' },
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
    expect(events).toContainEqual({ kind: 'reasoning-delta', text: 'only think' })
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
})
