/**
 * Render a tip's markdown body with consistent styling and sanitization.
 *
 * Sanitization is non-negotiable: tip bodies render as HTML, so a forgotten
 * sanitize plugin would let arbitrary markup or `javascript:` links through.
 * `rehypeRaw` is intentionally NOT enabled — tip bodies are markdown only.
 *
 * Heading tags (h1–h6) are stripped from the allowlist so a tip body cannot
 * inject mid-page headings that break the surrounding document outline (the
 * /docs/tips page already has h1/h3 structure).
 */
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'

interface TipBodyProps {
  body: string
}

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])

const tipSanitizeSchema = {
  ...defaultSchema,
  tagNames: defaultSchema.tagNames?.filter((tag) => !HEADING_TAGS.has(tag)),
}

/**
 * Markdown link override:
 *   - `/path` → react-router `<Link>` (SPA transition, no new tab)
 *   - `#fragment` → plain `<a>` (in-page anchor)
 *   - everything else → external link in a new tab with rel="noopener noreferrer"
 */
function MarkdownLink({
  href,
  children,
}: {
  href?: string
  children?: ReactNode
}): ReactNode {
  if (href === undefined) return <a>{children}</a>
  if (href.startsWith('/')) {
    return <Link to={href}>{children}</Link>
  }
  if (href.startsWith('#')) {
    return <a href={href}>{children}</a>
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  )
}

export function TipBody({ body }: TipBodyProps): ReactNode {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, tipSanitizeSchema]]}
        components={{ a: MarkdownLink }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
