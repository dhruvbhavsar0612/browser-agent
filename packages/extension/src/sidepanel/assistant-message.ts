import type {
  AssistantMessageSegment,
  ChatMessage,
  PartRecord,
  StreamEvent,
} from '@browser-agent/core'

export type UiMessage = ChatMessage & {
  id: string
  segments?: AssistantMessageSegment[]
}

export type TranscriptRow = {
  id: string
  role: string
  parts: PartRecord[]
}

function completeStreamingSegments(
  segments: AssistantMessageSegment[],
  exceptId?: string,
): AssistantMessageSegment[] {
  return segments.map((segment) =>
    segment.id !== exceptId &&
    (segment.type === 'text' || segment.type === 'reasoning') &&
    segment.status === 'streaming'
      ? { ...segment, status: 'complete' }
      : segment,
  )
}

function appendContentDelta(
  segments: AssistantMessageSegment[],
  type: 'text' | 'reasoning',
  text: string,
  segmentId?: string,
): AssistantMessageSegment[] {
  const explicitIndex = segmentId
    ? segments.findIndex((segment) => segment.id === segmentId && segment.type === type)
    : -1

  if (explicitIndex >= 0) {
    const next = completeStreamingSegments(segments, segmentId)
    const segment = next[explicitIndex]
    if (!segment || (segment.type !== 'text' && segment.type !== 'reasoning')) return next
    next[explicitIndex] = {
      ...segment,
      content: segment.content + text,
      status: 'streaming',
    }
    return next
  }

  const last = segments.at(-1)
  if (!segmentId && last?.type === type && last.status === 'streaming') {
    return [
      ...segments.slice(0, -1),
      {
        ...last,
        content: last.content + text,
      },
    ]
  }

  const next = completeStreamingSegments(segments)
  next.push({
    id: segmentId ?? `legacy-${type}-${segments.length}`,
    type,
    content: text,
    status: 'streaming',
  })
  return next
}

/** Pure chronological reducer for assistant stream events. */
export function reduceAssistantSegments(
  segments: AssistantMessageSegment[],
  event: StreamEvent,
): AssistantMessageSegment[] {
  switch (event.kind) {
    case 'segment-start': {
      const existing = segments.findIndex(
        (segment) => segment.id === event.segmentId && segment.type === event.segmentType,
      )
      const next = completeStreamingSegments(segments, event.segmentId)
      if (existing >= 0) {
        const segment = next[existing]
        if (segment?.type === 'text' || segment?.type === 'reasoning') {
          next[existing] = { ...segment, status: 'streaming' }
        }
        return next
      }
      next.push({
        id: event.segmentId,
        type: event.segmentType,
        content: '',
        status: 'streaming',
      })
      return next
    }

    case 'segment-end':
      return segments.flatMap((segment) => {
        if (
          segment.id !== event.segmentId ||
          segment.type !== event.segmentType ||
          (segment.type !== 'text' && segment.type !== 'reasoning')
        ) {
          return [segment]
        }
        return segment.content ? [{ ...segment, status: 'complete' }] : []
      })

    case 'text-delta':
      return appendContentDelta(segments, 'text', event.text, event.segmentId)

    case 'reasoning-delta':
      return appendContentDelta(segments, 'reasoning', event.text, event.segmentId)

    case 'tool-call': {
      const next = completeStreamingSegments(segments)
      const index = next.findIndex(
        (segment) =>
          segment.type === 'tool' &&
          (segment.id === event.segmentId || segment.toolCallId === event.toolCallId),
      )
      const tool = {
        id: event.segmentId ?? (index >= 0 ? next[index]!.id : `tool-${event.toolCallId}`),
        type: 'tool' as const,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        args: event.args,
        result: index >= 0 && next[index]?.type === 'tool' ? next[index].result : undefined,
        status:
          index >= 0 && next[index]?.type === 'tool' && next[index].status === 'done'
            ? ('done' as const)
            : ('pending' as const),
      }
      if (index >= 0) {
        next[index] = tool
        return next
      }
      next.push(tool)
      return next
    }

    case 'tool-result': {
      const index = segments.findIndex(
        (segment) =>
          segment.type === 'tool' &&
          (segment.id === event.segmentId || segment.toolCallId === event.toolCallId),
      )
      if (index < 0) {
        return [
          ...completeStreamingSegments(segments),
          {
            id: event.segmentId ?? `tool-${event.toolCallId}`,
            type: 'tool',
            toolCallId: event.toolCallId,
            toolName: 'tool',
            result: event.result,
            status: 'done',
          },
        ]
      }
      return segments.map((segment, segmentIndex) =>
        segmentIndex === index && segment.type === 'tool'
          ? { ...segment, result: event.result, status: 'done' }
          : segment,
      )
    }

    case 'step-start':
    case 'step-end':
    case 'done':
    case 'error':
      return completeStreamingSegments(segments)

    case 'permission-ask':
    case 'compaction':
      return segments
  }
}

export function assistantSegmentsText(segments: AssistantMessageSegment[]): string {
  return segments
    .filter((segment) => segment.type === 'text')
    .map((segment) => segment.content)
    .join('')
}

/** Rebuilds the same ordered model from existing and segmentation-aware records. */
export function transcriptToMessages(rows: TranscriptRow[]): UiMessage[] {
  const messages: UiMessage[] = []

  for (const row of rows) {
    if (row.role !== 'user' && row.role !== 'assistant') continue

    if (row.role === 'user') {
      messages.push({
        id: row.id,
        role: 'user',
        content: row.parts
          .filter((part) => part.type === 'text' && typeof part.content === 'string')
          .map((part) => part.content as string)
          .join(''),
      })
      continue
    }

    let segments: AssistantMessageSegment[] = []
    for (const part of row.parts) {
      if (part.type === 'text' && typeof part.content === 'string') {
        segments = reduceAssistantSegments(segments, {
          kind: 'segment-start',
          segmentId: part.id,
          segmentType: 'text',
        })
        segments = reduceAssistantSegments(segments, {
          kind: 'text-delta',
          segmentId: part.id,
          text: part.content,
        })
        segments = reduceAssistantSegments(segments, {
          kind: 'segment-end',
          segmentId: part.id,
          segmentType: 'text',
        })
      } else if (part.type === 'reasoning' && typeof part.content === 'string') {
        segments = reduceAssistantSegments(segments, {
          kind: 'segment-start',
          segmentId: part.id,
          segmentType: 'reasoning',
        })
        segments = reduceAssistantSegments(segments, {
          kind: 'reasoning-delta',
          segmentId: part.id,
          text: part.content,
        })
        segments = reduceAssistantSegments(segments, {
          kind: 'segment-end',
          segmentId: part.id,
          segmentType: 'reasoning',
        })
      } else if (part.type === 'tool-call') {
        const call = part.content as {
          toolCallId?: string
          toolName?: string
          args?: unknown
        }
        if (call.toolCallId && call.toolName) {
          segments = reduceAssistantSegments(segments, {
            kind: 'tool-call',
            segmentId: part.id,
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            args: call.args,
          })
        }
      } else if (part.type === 'tool-result') {
        const result = part.content as {
          toolCallId?: string
          segmentId?: string
          result?: unknown
        }
        if (result.toolCallId) {
          segments = reduceAssistantSegments(segments, {
            kind: 'tool-result',
            segmentId: result.segmentId,
            toolCallId: result.toolCallId,
            result: result.result,
          })
        }
      }
    }

    messages.push({
      id: row.id,
      role: 'assistant',
      content: assistantSegmentsText(segments),
      segments,
    })
  }

  return messages
}
