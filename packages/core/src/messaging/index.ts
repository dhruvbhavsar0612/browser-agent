import { z } from 'zod'

/** Named chrome.runtime.Port channels */
export const PortName = z.enum(['browser-agent.stream'])
export type PortName = z.infer<typeof PortName>

export const PORT_NAMES = {
  STREAM: 'browser-agent.stream',
} as const satisfies Record<string, PortName>

export const MessageType = z.enum([
  'ping',
  'pong',
  'config.get',
  'config.set',
  'session.list',
  'session.get',
  'session.create',
  'session.update',
  'session.delete',
  'vault.set',
  'vault.list',
  'vault.delete',
  'vault.clear',
  'oauth.connect',
  'oauth.complete',
  'oauth.disconnect',
  'models.list',
  'models.discover',
  'model.test',
  'agent.prompt',
  'agent.stop',
  'permission.reply',
  'stream.event',
  /** Triggers a short fake stream over the stream port (infra demo only) */
  'stream.demo',
  'error',
])
export type MessageType = z.infer<typeof MessageType>

export const Envelope = z.object({
  id: z.string().min(1),
  type: MessageType,
  payload: z.unknown().optional(),
  /** Monotonic sequence for ordered stream.event delivery */
  seq: z.number().int().nonnegative().optional(),
})
export type Envelope = z.infer<typeof Envelope>

export type AssistantTextSegment = {
  id: string
  type: 'text'
  content: string
  status: 'streaming' | 'complete'
}

export type AssistantReasoningSegment = {
  id: string
  type: 'reasoning'
  content: string
  status: 'streaming' | 'complete'
}

export type AssistantToolSegment = {
  id: string
  type: 'tool'
  toolCallId: string
  toolName: string
  args?: unknown
  result?: unknown
  status: 'pending' | 'done' | 'error'
}

/** Ordered display unit shared by live streams and transcript reconstruction. */
export type AssistantMessageSegment =
  AssistantTextSegment | AssistantReasoningSegment | AssistantToolSegment

export const StreamEvent = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('segment-start'),
    segmentId: z.string().min(1),
    segmentType: z.enum(['text', 'reasoning']),
  }),
  z.object({
    kind: z.literal('segment-end'),
    segmentId: z.string().min(1),
    segmentType: z.enum(['text', 'reasoning']),
  }),
  z.object({
    kind: z.literal('step-start'),
    stepId: z.string().min(1),
  }),
  z.object({
    kind: z.literal('step-end'),
    stepId: z.string().min(1),
    finishReason: z.string().optional(),
  }),
  // segmentId remains optional so in-flight events from an older background
  // worker can still be consumed after an extension update.
  z.object({ kind: z.literal('text-delta'), text: z.string(), segmentId: z.string().optional() }),
  z.object({
    kind: z.literal('reasoning-delta'),
    text: z.string(),
    segmentId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
    segmentId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('tool-result'),
    toolCallId: z.string(),
    result: z.unknown(),
    segmentId: z.string().optional(),
  }),
  z.object({
    kind: z.literal('permission-ask'),
    requestId: z.string(),
    permission: z.string(),
    patterns: z.array(z.string()),
    metadata: z.unknown().optional(),
  }),
  z.object({
    kind: z.literal('compaction'),
    status: z.enum(['started', 'completed', 'failed', 'retrying']),
    message: z.string(),
    epoch: z.number().int().positive().optional(),
  }),
  z.object({ kind: z.literal('error'), message: z.string() }),
  z.object({ kind: z.literal('done') }),
])
export type StreamEvent = z.infer<typeof StreamEvent>

export function createEnvelope(type: MessageType, payload?: unknown, id?: string): Envelope {
  return { id: id ?? crypto.randomUUID(), type, payload }
}

/** Alias for outbound request envelopes (new correlation id). */
export function createRequest(type: MessageType, payload?: unknown): Envelope {
  return createEnvelope(type, payload)
}

/** Response that reuses the request's correlation id. */
export function createResponse(
  request: Pick<Envelope, 'id'>,
  type: MessageType,
  payload?: unknown,
): Envelope {
  return createEnvelope(type, payload, request.id)
}

export function createErrorResponse(request: Pick<Envelope, 'id'>, message: string): Envelope {
  return createResponse(request, 'error', { message })
}

export function createStreamEnvelope(
  event: StreamEvent,
  opts?: { id?: string; seq?: number },
): Envelope {
  const envelope = createEnvelope('stream.event', event, opts?.id)
  if (opts?.seq !== undefined) {
    envelope.seq = opts.seq
  }
  return envelope
}

export function parseEnvelope(data: unknown): Envelope {
  return Envelope.parse(data)
}

export function safeParseEnvelope(data: unknown) {
  return Envelope.safeParse(data)
}

export function parseStreamEvent(data: unknown): StreamEvent {
  return StreamEvent.parse(data)
}

export function safeParseStreamEvent(data: unknown) {
  return StreamEvent.safeParse(data)
}

export function isStreamEventEnvelope(envelope: Envelope): boolean {
  return envelope.type === 'stream.event'
}
