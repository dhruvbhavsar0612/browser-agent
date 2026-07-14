import { describe, expect, it, vi } from 'vitest'
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
    expect(events).toEqual([{ kind: 'text-delta', text: 'Hi' }, { kind: 'done' }])
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
})
