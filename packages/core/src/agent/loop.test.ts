import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TextStreamPart, ToolSet } from 'ai'
import { MemorySessionStore } from '../session/index.js'
import type { StreamEvent } from '../messaging/index.js'

const streamTextMock = vi.fn()

vi.mock('ai', async (importOriginal) => {
  const mod = await importOriginal<typeof import('ai')>()
  return {
    ...mod,
    streamText: (...args: unknown[]) => streamTextMock(...args),
  }
})

import { runAgentLoop } from './loop.js'

function mockFullStream(parts: TextStreamPart<ToolSet>[]) {
  streamTextMock.mockReturnValue({
    fullStream: (async function* () {
      for (const part of parts) {
        yield part
      }
    })(),
  })
}

describe('runAgentLoop', () => {
  beforeEach(() => {
    streamTextMock.mockReset()
  })

  it('pipes fullStream through the processor and emits done', async () => {
    mockFullStream([
      { type: 'text-delta', id: 't1', text: 'Hi' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    const events: StreamEvent[] = []
    const result = await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'Hello' }],
      onEvent: (event) => events.push(event),
      steps: 3,
    })

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        stopWhen: expect.any(Function),
        messages: [{ role: 'user', content: 'Hello' }],
      }),
    )
    expect(events.map((event) => event.kind)).toEqual([
      'segment-start',
      'text-delta',
      'segment-end',
      'done',
    ])
    expect(events.find((event) => event.kind === 'text-delta')).toMatchObject({
      text: 'Hi',
      segmentId: expect.any(String),
    })
    expect(result.finishReason).toBe('stop')
  })

  it('persists user and assistant messages with parts', async () => {
    mockFullStream([
      { type: 'text-delta', id: 't1', text: 'Answer' },
      { type: 'text-end', id: 't1' },
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse' })
    const events: StreamEvent[] = []

    await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'Question' }],
      onEvent: (event) => events.push(event),
      session: { store, sessionId: session.id },
    })

    const transcript = await store.getTranscript(session.id)
    expect(transcript).toHaveLength(2)
    expect(transcript[0]?.role).toBe('user')
    expect(transcript[0]?.parts[0]).toMatchObject({ type: 'text', content: 'Question' })
    expect(transcript[1]?.role).toBe('assistant')
    expect(transcript[1]?.parts[0]).toMatchObject({ type: 'text', content: 'Answer' })
  })

  it('skips done when aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    mockFullStream([{ type: 'text-delta', id: 't1', text: 'nope' }])

    const events: StreamEvent[] = []
    await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'Hi' }],
      onEvent: (event) => events.push(event),
      abortSignal: controller.signal,
    })

    expect(events.some((event) => event.kind === 'done')).toBe(false)
  })

  it('compacts and retries once on a context overflow before visible output', async () => {
    streamTextMock
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield {
            type: 'error',
            error: new Error('maximum context length exceeded'),
          } as TextStreamPart<ToolSet>
        })(),
      })
      .mockReturnValueOnce({
        fullStream: (async function* () {
          yield { type: 'text-delta', id: 't2', text: 'Recovered' } as TextStreamPart<ToolSet>
          yield { type: 'text-end', id: 't2' } as TextStreamPart<ToolSet>
          yield {
            type: 'finish',
            finishReason: 'stop',
            rawFinishReason: 'stop',
            totalUsage: {},
          } as TextStreamPart<ToolSet>
        })(),
      })
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse' })
    const events: StreamEvent[] = []
    const onContextOverflow = vi.fn(async () => ({
      messages: [{ role: 'user' as const, content: 'compacted question' }],
      system: 'agent prompt with compacted summary',
    }))

    await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'large question' }],
      onEvent: (event) => events.push(event),
      onContextOverflow,
      session: { store, sessionId: session.id },
    })

    expect(onContextOverflow).toHaveBeenCalledOnce()
    expect(streamTextMock).toHaveBeenCalledTimes(2)
    expect(streamTextMock.mock.calls.at(-1)?.[0]).toMatchObject({
      messages: [{ role: 'user', content: 'compacted question' }],
      system: 'agent prompt with compacted summary',
    })
    expect(events.map((event) => event.kind)).toEqual([
      'segment-start',
      'text-delta',
      'segment-end',
      'done',
    ])
    expect(events.find((event) => event.kind === 'text-delta')).toMatchObject({
      text: 'Recovered',
    })
    const transcript = await store.getTranscript(session.id)
    expect(transcript).toHaveLength(2)
    expect(transcript[0]?.parts[0]?.content).toBe('large question')
    expect(transcript[1]?.parts[0]?.content).toBe('Recovered')
  })

  it('does not retry an overflow after visible output', async () => {
    mockFullStream([
      { type: 'text-delta', id: 't1', text: 'Partial' },
      {
        type: 'error',
        error: new Error('context length exceeded'),
      } as TextStreamPart<ToolSet>,
    ])
    const events: StreamEvent[] = []
    const onContextOverflow = vi.fn(async () => ({
      messages: [{ role: 'user' as const, content: 'compacted' }],
    }))

    await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'large question' }],
      onEvent: (event) => events.push(event),
      onContextOverflow,
    })

    expect(onContextOverflow).not.toHaveBeenCalled()
    expect(streamTextMock).toHaveBeenCalledOnce()
    expect(events.map((event) => event.kind)).toEqual([
      'segment-start',
      'text-delta',
      'segment-end',
      'error',
    ])
    expect(events.find((event) => event.kind === 'text-delta')).toMatchObject({ text: 'Partial' })
    expect(events.at(-1)).toEqual({ kind: 'error', message: 'context length exceeded' })
  })

  it('forwards providerOptions to streamText', async () => {
    mockFullStream([
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    const providerOptions = { openai: { reasoningEffort: 'high' } }
    await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'Think hard' }],
      onEvent: () => {},
      providerOptions,
    })

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions }),
    )
  })

  it('omits providerOptions from streamText when not set', async () => {
    mockFullStream([
      { type: 'finish', finishReason: 'stop', rawFinishReason: 'stop', totalUsage: {} as never },
    ])

    await runAgentLoop({
      model: {} as never,
      messages: [{ role: 'user', content: 'Hello' }],
      onEvent: () => {},
    })

    expect(streamTextMock).toHaveBeenCalledWith(
      expect.objectContaining({ providerOptions: undefined }),
    )
  })
})
