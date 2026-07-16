import type { NormalizedMcpToolResult } from './types.js'

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/g

function serialize(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

function cap(value: unknown, maxChars: number): unknown {
  const text = serialize(value)
  if (text.length <= maxChars) return value
  return {
    truncated: true,
    originalChars: text.length,
    preview: text.slice(0, Math.max(256, maxChars)),
  }
}

/**
 * Converts arbitrary MCP content into a bounded, durable result before it can
 * reach an AI stream, transcript, or compaction input.
 */
export function normalizeMcpToolResult(
  input: unknown,
  metadata: { serverId: string; serverName: string; toolName: string },
  maxChars = 12_000,
): NormalizedMcpToolResult {
  const value = input && typeof input === 'object' ? (input as Record<string, unknown>) : {}
  const isError = value.isError === true
  const rawContent = Array.isArray(value.content) ? value.content : []
  const rawStructured = value.structuredContent
  const serialized = serialize({ content: rawContent, structuredContent: rawStructured })
  const urls = [...new Set(serialized.match(URL_PATTERN) ?? [])].slice(0, 20)
  const textSummary = rawContent
    .filter(
      (item): item is { type: string; text: string } =>
        !!item &&
        typeof item === 'object' &&
        (item as { type?: unknown }).type === 'text' &&
        typeof (item as { text?: unknown }).text === 'string',
    )
    .map((item) => item.text)
    .join('\n')
    .trim()
    .slice(0, 2_000)

  const result: NormalizedMcpToolResult = {
    _mcp: { ...metadata, isError },
    content: rawContent,
    ...(rawStructured !== undefined ? { structuredContent: rawStructured } : {}),
    ...(textSummary ? { summary: textSummary } : {}),
    ...(urls.length ? { urls } : {}),
    ...(isError ? { error: textSummary || 'Remote MCP tool reported an error' } : {}),
  }

  if (serialized.length <= maxChars) return result

  const contentBudget = Math.max(1_000, Math.floor(maxChars * 0.65))
  const structuredBudget = Math.max(500, maxChars - contentBudget - 1_000)
  return {
    ...result,
    content: rawContent.map((item) =>
      cap(item, Math.max(500, contentBudget / Math.max(1, rawContent.length))),
    ),
    ...(rawStructured !== undefined
      ? { structuredContent: cap(rawStructured, structuredBudget) }
      : {}),
    truncated: true,
    originalChars: serialized.length,
  }
}

export function mcpResultErrorMessage(result: NormalizedMcpToolResult): string | undefined {
  return result._mcp.isError
    ? (result.error ?? result.summary ?? 'Remote MCP tool failed')
    : undefined
}
