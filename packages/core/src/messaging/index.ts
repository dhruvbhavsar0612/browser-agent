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
  'vault.set',
  'vault.list',
  'vault.delete',
  'vault.clear',
  'models.list',
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

export const StreamEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text-delta'), text: z.string() }),
  z.object({
    kind: z.literal('tool-call'),
    toolCallId: z.string(),
    toolName: z.string(),
    args: z.unknown(),
  }),
  z.object({
    kind: z.literal('tool-result'),
    toolCallId: z.string(),
    result: z.unknown(),
  }),
  z.object({
    kind: z.literal('permission-ask'),
    requestId: z.string(),
    permission: z.string(),
    patterns: z.array(z.string()),
    metadata: z.unknown().optional(),
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
export function createResponse(request: Pick<Envelope, 'id'>, type: MessageType, payload?: unknown): Envelope {
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
