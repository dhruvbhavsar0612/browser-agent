import { z } from 'zod'

export const MessageType = z.enum([
  'ping',
  'pong',
  'config.get',
  'config.set',
  'session.list',
  'session.get',
  'session.create',
  'agent.prompt',
  'agent.stop',
  'permission.reply',
  'stream.event',
  'error',
])
export type MessageType = z.infer<typeof MessageType>

export const Envelope = z.object({
  id: z.string(),
  type: MessageType,
  payload: z.unknown().optional(),
})
export type Envelope = z.infer<typeof Envelope>

export const StreamEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text-delta'), text: z.string() }),
  z.object({ kind: z.literal('tool-call'), toolCallId: z.string(), toolName: z.string(), args: z.unknown() }),
  z.object({ kind: z.literal('tool-result'), toolCallId: z.string(), result: z.unknown() }),
  z.object({ kind: z.literal('permission-ask'), requestId: z.string(), permission: z.string(), patterns: z.array(z.string()), metadata: z.unknown().optional() }),
  z.object({ kind: z.literal('error'), message: z.string() }),
  z.object({ kind: z.literal('done') }),
])
export type StreamEvent = z.infer<typeof StreamEvent>

export function createEnvelope(type: MessageType, payload?: unknown, id?: string): Envelope {
  return { id: id ?? crypto.randomUUID(), type, payload }
}
