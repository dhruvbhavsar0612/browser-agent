import { describe, expect, it } from 'vitest'
import {
  Envelope,
  StreamEvent,
  createEnvelope,
  createRequest,
  createResponse,
  createStreamEnvelope,
  parseEnvelope,
  parseStreamEvent,
  safeParseEnvelope,
  safeParseStreamEvent,
} from './index.js'

describe('messaging envelope', () => {
  it('round-trips createEnvelope → parseEnvelope', () => {
    const original = createEnvelope('ping', { nonce: 1 })
    const parsed = parseEnvelope(JSON.parse(JSON.stringify(original)))
    expect(parsed).toEqual(original)
    expect(parsed.id).toBeTruthy()
    expect(parsed.type).toBe('ping')
  })

  it('createRequest / createResponse share correlation id', () => {
    const request = createRequest('config.get')
    const response = createResponse(request, 'config.get', { executionMode: 'approval' })
    expect(response.id).toBe(request.id)
    expect(response.type).toBe('config.get')
  })

  it('rejects invalid envelopes', () => {
    expect(safeParseEnvelope({ id: 'x', type: 'not-a-type' }).success).toBe(false)
    expect(safeParseEnvelope({ type: 'ping' }).success).toBe(false)
    expect(() => parseEnvelope(null)).toThrow()
  })

  it('accepts optional seq on Envelope schema', () => {
    const envelope = Envelope.parse({
      id: 'a',
      type: 'stream.event',
      payload: { kind: 'done' },
      seq: 3,
    })
    expect(envelope.seq).toBe(3)
  })

  it('accepts oauth message types', () => {
    for (const type of ['oauth.connect', 'oauth.complete', 'oauth.disconnect'] as const) {
      const envelope = createEnvelope(type, { providerId: 'openai' })
      expect(parseEnvelope(JSON.parse(JSON.stringify(envelope))).type).toBe(type)
    }
  })
})

describe('stream events', () => {
  it('parses every StreamEvent kind', () => {
    const events: StreamEvent[] = [
      { kind: 'segment-start', segmentId: 's1', segmentType: 'text' },
      { kind: 'text-delta', segmentId: 's1', text: 'hi' },
      { kind: 'segment-end', segmentId: 's1', segmentType: 'text' },
      { kind: 'step-start', stepId: 'step-1' },
      { kind: 'step-end', stepId: 'step-1', finishReason: 'stop' },
      { kind: 'reasoning-delta', segmentId: 'r1', text: 'thinking' },
      {
        kind: 'tool-call',
        segmentId: 'tool-1',
        toolCallId: 't1',
        toolName: 'click',
        args: { x: 1 },
      },
      { kind: 'tool-result', segmentId: 'tool-1', toolCallId: 't1', result: { ok: true } },
      {
        kind: 'permission-ask',
        requestId: 'r1',
        permission: 'click',
        patterns: ['https://*'],
      },
      { kind: 'error', message: 'boom' },
      { kind: 'done' },
    ]

    for (const event of events) {
      const roundTrip = parseStreamEvent(JSON.parse(JSON.stringify(event)))
      expect(roundTrip).toEqual(event)
    }
  })

  it('rejects malformed stream events', () => {
    expect(safeParseStreamEvent({ kind: 'text-delta' }).success).toBe(false)
    expect(safeParseStreamEvent({ kind: 'unknown' }).success).toBe(false)
    expect(() => parseStreamEvent({})).toThrow()
  })

  it('createStreamEnvelope wraps event with type and seq', () => {
    const event: StreamEvent = { kind: 'text-delta', text: 'a' }
    const envelope = createStreamEnvelope(event, { id: 'req-1', seq: 0 })
    expect(envelope.type).toBe('stream.event')
    expect(envelope.id).toBe('req-1')
    expect(envelope.seq).toBe(0)
    expect(parseStreamEvent(envelope.payload)).toEqual(event)
  })

  it('preserves ordered seq across a demo stream payload list', () => {
    const chunks = ['Hello', ' ', 'world']
    const envelopes = [
      ...chunks.map((text, seq) => createStreamEnvelope({ kind: 'text-delta', text }, { seq })),
      createStreamEnvelope({ kind: 'done' }, { seq: chunks.length }),
    ]

    const seqs = envelopes.map((e) => e.seq)
    expect(seqs).toEqual([0, 1, 2, 3])

    for (const envelope of envelopes) {
      expect(parseEnvelope(JSON.parse(JSON.stringify(envelope))).type).toBe('stream.event')
    }
  })
})
