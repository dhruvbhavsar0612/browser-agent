import { useMemo } from 'react'
import DOMPurify, { type Config } from 'dompurify'
import { marked } from 'marked'

marked.setOptions({
  gfm: true,
  breaks: true,
})

const PURIFY_CONFIG: Config = {
  ALLOWED_TAGS: [
    'p',
    'br',
    'strong',
    'em',
    'b',
    'i',
    'code',
    'pre',
    'ul',
    'ol',
    'li',
    'a',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'hr',
    'span',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  ALLOW_DATA_ATTR: false,
}

export function MarkdownContent({ source }: { source: string }) {
  const html = useMemo(() => {
    if (!source) return ''
    const raw = marked.parse(source, { async: false }) as string
    return DOMPurify.sanitize(raw, PURIFY_CONFIG)
  }, [source])

  if (!html) return null

  return <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
}
