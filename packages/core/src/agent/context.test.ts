import { describe, expect, it, vi } from 'vitest'
import type { CompactionConfig } from '../config/schema.js'
import {
  MemorySessionStore,
  type CompactionRecord,
  type MessageRecord,
  type PartRecord,
} from '../session/index.js'
import {
  buildSessionPrompt,
  capToolValue,
  estimateModelMessageTokens,
  findCompactionCutoff,
  prepareSessionPrompt,
  resolveContextBudget,
  transcriptToModelMessages,
  type TranscriptMessage,
} from './context.js'

const config: CompactionConfig = {
  fallbackContextTokens: 8_192,
  threshold: 0.72,
  reserveTokens: 1_024,
  recentTurns: 1,
  maxToolResultChars: 2_000,
}

function part(
  messageId: string,
  type: PartRecord['type'],
  content: unknown,
  order: number,
): PartRecord {
  return { id: `p-${messageId}-${order}`, messageId, type, content, createdAt: order }
}

function message(
  id: string,
  role: MessageRecord['role'],
  parts: PartRecord[],
  order: number,
): TranscriptMessage {
  return { id, sessionId: 's1', role, parts, createdAt: order }
}

describe('transcript prompt reconstruction', () => {
  it('preserves assistant text and complete tool pairs without replaying reasoning', () => {
    const transcript = [
      message('u1', 'user', [part('u1', 'text', 'Find the page', 1)], 1),
      message(
        'a1',
        'assistant',
        [
          part('a1', 'reasoning', 'private chain of thought', 2),
          part('a1', 'text', 'I will inspect it.', 3),
          part(
            'a1',
            'tool-call',
            { toolCallId: 'call-1', toolName: 'page_read', args: { tabId: 7 } },
            4,
          ),
          part('a1', 'tool-result', { toolCallId: 'call-1', result: { title: 'Docs' } }, 5),
          part('a1', 'text', 'The title is Docs.', 6),
          part('a1', 'tool-call', { toolCallId: 'orphan', toolName: 'page_read', args: {} }, 7),
        ],
        2,
      ),
    ]

    const result = transcriptToModelMessages(transcript)
    expect(result).toEqual([
      { role: 'user', content: 'Find the page' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'I will inspect it.' },
          {
            type: 'tool-call',
            toolCallId: 'call-1',
            toolName: 'page_read',
            input: { tabId: 7 },
          },
        ],
      },
      {
        role: 'tool',
        content: [
          {
            type: 'tool-result',
            toolCallId: 'call-1',
            toolName: 'page_read',
            output: { type: 'json', value: { title: 'Docs' } },
          },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'The title is Docs.' }] },
    ])
    expect(JSON.stringify(result)).not.toContain('private chain of thought')
    expect(JSON.stringify(result)).not.toContain('orphan')
  })

  it('moves a cutoff backward rather than splitting a tool pair', () => {
    const transcript = [
      message('u1', 'user', [part('u1', 'text', 'one', 1)], 1),
      message('a1', 'assistant', [part('a1', 'text', 'one answer', 2)], 2),
      message('u2', 'user', [part('u2', 'text', 'two', 3)], 3),
      message(
        'a2',
        'assistant',
        [part('a2', 'tool-call', { toolCallId: 'crossing', toolName: 'tabs', args: {} }, 4)],
        4,
      ),
      message('u3', 'user', [part('u3', 'text', 'three', 5)], 5),
      message(
        't2',
        'tool',
        [part('t2', 'tool-result', { toolCallId: 'crossing', result: ['a'] }, 6)],
        6,
      ),
      message('u4', 'user', [part('u4', 'text', 'four', 7)], 7),
      message('a4', 'assistant', [part('a4', 'text', 'four answer', 8)], 8),
    ]

    expect(findCompactionCutoff(transcript, { recentTurns: 2 })).toBe(1)
  })

  it('caps large tool values while retaining URLs and errors', () => {
    const capped = capToolValue(
      {
        body: 'x'.repeat(5_000),
        url: 'https://example.com/report',
        error: 'request timed out',
      },
      1_000,
    )
    expect(capped).toMatchObject({
      truncated: true,
      urls: ['https://example.com/report'],
      errors: ['request timed out'],
    })
  })
})

describe('context estimation and compaction', () => {
  it('uses discovered context and a conservative configurable fallback', () => {
    expect(resolveContextBudget(100_000, config)).toMatchObject({
      contextTokens: 100_000,
      usedFallback: false,
      reserveTokens: 1_024,
    })
    expect(resolveContextBudget(0, config)).toMatchObject({
      contextTokens: 8_192,
      usedFallback: true,
    })
    expect(resolveContextBudget(0, config).triggerInputTokens).toBe(
      Math.floor(8_192 * 0.72) - 1_024,
    )
  })

  it('estimates larger structured prompts as larger', () => {
    const small = estimateModelMessageTokens([{ role: 'user', content: 'hello' }], 'system')
    const large = estimateModelMessageTokens([{ role: 'user', content: 'hello'.repeat(2_000) }])
    expect(small).toBeGreaterThan(0)
    expect(large).toBeGreaterThan(small)
  })

  it('does nothing below threshold', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse' })
    const user = await store.appendMessage({ sessionId: session.id, role: 'user' })
    await store.appendPart({ messageId: user.id, type: 'text', content: 'hello' })
    const summarize = vi.fn(async () => 'summary')

    const prepared = await prepareSessionPrompt({
      store,
      sessionId: session.id,
      newestUserMessage: 'next',
      config,
      summarize,
    })

    expect(prepared.compacted).toBe(false)
    expect(summarize).not.toHaveBeenCalled()
    expect(await store.getLatestCompaction(session.id)).toBeNull()
  })

  it('persists a summary epoch while retaining the full transcript', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse' })
    for (let turn = 0; turn < 3; turn += 1) {
      const user = await store.appendMessage({ sessionId: session.id, role: 'user' })
      await store.appendPart({
        messageId: user.id,
        type: 'text',
        content: `request-${turn} ${'x'.repeat(8_000)}`,
      })
      const assistant = await store.appendMessage({ sessionId: session.id, role: 'assistant' })
      await store.appendPart({
        messageId: assistant.id,
        type: 'text',
        content: `answer-${turn} ${'y'.repeat(8_000)}`,
      })
    }
    const before = await store.getTranscript(session.id)
    const statuses: string[] = []

    const prepared = await prepareSessionPrompt({
      store,
      sessionId: session.id,
      newestUserMessage: 'latest request',
      config,
      sourceModel: 'openai/gpt-test',
      summarize: async () => 'Earlier requests and answers were retained.',
      onCompaction: (event) => statuses.push(event.status),
    })

    expect(prepared.compacted).toBe(true)
    expect(prepared.summary).toContain('Earlier requests')
    expect(statuses).toEqual(['started', 'completed'])
    const saved = await store.getLatestCompaction(session.id)
    expect(saved).toMatchObject({ epoch: 1, sourceModel: 'openai/gpt-test' })
    expect(await store.getTranscript(session.id)).toEqual(before)
    expect(prepared.messages.at(-1)).toEqual({ role: 'user', content: 'latest request' })
  })

  it('builds from the latest summary plus only the uncompacted suffix', async () => {
    const transcript = [
      message('u1', 'user', [part('u1', 'text', 'old', 1)], 1),
      message('a1', 'assistant', [part('a1', 'text', 'old answer', 2)], 2),
      message('u2', 'user', [part('u2', 'text', 'recent', 3)], 3),
    ]
    const compaction: CompactionRecord = {
      id: 'c1',
      sessionId: 's1',
      epoch: 1,
      summary: 'Old exchange summary',
      compactedThroughMessageId: 'a1',
      estimatedTokensBefore: 100,
      estimatedTokensAfter: 20,
      createdAt: 10,
    }

    const prompt = buildSessionPrompt(transcript, 'newest', compaction)
    expect(prompt.summary).toBe('Old exchange summary')
    expect(prompt.messages).toEqual([
      { role: 'user', content: 'recent' },
      { role: 'user', content: 'newest' },
    ])
  })

  it('compacts when switching the same session to a smaller discovered context', async () => {
    const store = new MemorySessionStore()
    const session = await store.createSession({ agent: 'browse', model: 'large/model' })
    for (let turn = 0; turn < 2; turn += 1) {
      const user = await store.appendMessage({ sessionId: session.id, role: 'user' })
      await store.appendPart({
        messageId: user.id,
        type: 'text',
        content: `question ${'q'.repeat(8_000)}`,
      })
      const assistant = await store.appendMessage({ sessionId: session.id, role: 'assistant' })
      await store.appendPart({
        messageId: assistant.id,
        type: 'text',
        content: `answer ${'a'.repeat(8_000)}`,
      })
    }

    const large = await prepareSessionPrompt({
      store,
      sessionId: session.id,
      newestUserMessage: 'next',
      discoveredContext: 100_000,
      config,
      summarize: async () => 'summary',
    })
    expect(large.compacted).toBe(false)

    const small = await prepareSessionPrompt({
      store,
      sessionId: session.id,
      newestUserMessage: 'next',
      discoveredContext: 8_192,
      config,
      summarize: async () => 'summary',
    })
    expect(small.compacted).toBe(true)
  })
})
