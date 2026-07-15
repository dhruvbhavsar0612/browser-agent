import { z } from 'zod'
import { defineTool } from '../index.js'
import { requireBrowser, resolveTabId } from '../browser.js'
import { DEFAULT_PAGE_READ_MAX_CHARS } from './read.js'

const DEFAULT_MAX_MATCHES = 50
const CONTEXT_LINES = 1

export type PageGrepMatch = {
  lineNumber: number
  line: string
  match: string
  refIds?: string[]
  context: {
    before: string[]
    after: string[]
  }
}

export type PageGrepResult = {
  pattern: string
  matchCount: number
  truncated?: boolean
  matches: PageGrepMatch[]
}

export function extractRefIds(line: string): string[] {
  return [...line.matchAll(/ref_\d+/g)].map((m) => m[0])
}

export function grepPageContent(
  pageContent: string,
  pattern: string,
  options: { caseSensitive?: boolean; maxMatches?: number } = {},
): PageGrepResult {
  let regex: RegExp
  try {
    const flags = options.caseSensitive ? 'g' : 'gi'
    regex = new RegExp(pattern, flags)
  } catch {
    throw new Error(`Invalid regex pattern: ${pattern}`)
  }

  const lines = pageContent.split('\n')
  const maxMatches = options.maxMatches ?? DEFAULT_MAX_MATCHES
  const matches: PageGrepMatch[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) continue
    const lineMatch = line.match(regex)
    if (!lineMatch) continue

    const refIds = extractRefIds(line)
    matches.push({
      lineNumber: i + 1,
      line,
      match: lineMatch[0],
      ...(refIds.length > 0 ? { refIds } : {}),
      context: {
        before: lines.slice(Math.max(0, i - CONTEXT_LINES), i),
        after: lines.slice(i + 1, i + 1 + CONTEXT_LINES),
      },
    })

    if (matches.length >= maxMatches) break
  }

  return {
    pattern,
    matchCount: matches.length,
    ...(matches.length >= maxMatches ? { truncated: true } : {}),
    matches,
  }
}

export const pageGrepTool = defineTool({
  id: 'page_grep',
  description:
    'Search the page accessibility tree for a regex pattern. Returns matching lines with surrounding context and ref_ids when present.',
  parameters: z.object({
    pattern: z.string().min(1).describe('Regex pattern to search for in page text'),
    tabId: z.number().int().positive().optional().describe('Tab id (defaults to session tab)'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false)'),
    maxMatches: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('Maximum matches to return (default 50)'),
  }),
  permission: 'grep_page',
  permissionPatterns: () => ['*'],
  execute: async (args, ctx) => {
    const browser = requireBrowser(ctx)
    const tabId = resolveTabId(ctx, args.tabId)

    const { pageContent, error } = await browser.pageRead(tabId, {
      filter: 'all',
      maxChars: DEFAULT_PAGE_READ_MAX_CHARS,
    })

    if (error) {
      return { pattern: args.pattern, matchCount: 0, matches: [], error }
    }

    const result = grepPageContent(pageContent, args.pattern, {
      caseSensitive: args.caseSensitive,
      maxMatches: args.maxMatches,
    })

    return result
  },
})
