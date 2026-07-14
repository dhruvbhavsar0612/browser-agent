import { describe, expect, it, vi } from 'vitest'
import type { TextStreamPart } from 'ai'
import type { StreamEvent } from '../messaging/index.js'
import {
  DEFAULT_TOOL_RESULT_MAX_CHARS,
  processFullStream,
  truncateToolResultDefault,
  type DurablePart,
} from './processor.js'

async function* fixtureStream(
  parts: TextStreamPart<Record<string, never>>[],
): AsyncGenerator<TextStreamPart<Record<string, never>>> {
  for (const part of parts) {
    yield part
  }
}

function collect(
  parts: TextStreamPart<Record<string, never>>[],
  opts?: Parameters<typeof processFullStream>[1],
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

  it('maps reasoning deltas as text and persists reasoning parts', async () => {
    const { events, durable } = await collect([
      { type: 'reasoning-start', id: 'r1' },
      { type: 'reasoning-delta', id: 'r1', text: 'think' },
      { type: 'reasoning-end', id: 'r1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    expect(events).toEqual([{ kind: 'text-delta', text: 'think' }])
    expect(durable).toEqual([{ type: 'reasoning', content: 'think' }])
  })

  it('maps tool-call and tool-result events with durable parts', async () => {
    const { events, durable } = await collect([
      {
        type: 'tool-call',
        toolCallId: 'c1',
        toolName: 'echo',
        input: { text: 'hi' },
      },
      {
        type: 'tool-result',
        toolCallId: 'c1',
        toolName: 'echo',
        input: { text: 'hi' },
        output: { echoed: 'hi' },
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
})
