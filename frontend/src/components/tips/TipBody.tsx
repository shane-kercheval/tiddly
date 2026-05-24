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
 *
 * Inline code spans whose full text matches the `{{shortcut:<id>}}` grammar
 * are replaced with a localized `<Kbd>` chip so body prose stays in sync with
 * the shortcut registry. Anything else inside an inline code span renders
 * with the default `<code>` styling — the override is intentionally exact
 * match, no mixed content.
 */
import type { ComponentProps, ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { resolveShortcutToken } from '../markdown/shortcutToken'

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

/**
 * Markdown inline-code override:
 *   - `\`{{shortcut:<id>}}\`` (full match) → localized `<Kbd>` chip (shared
 *     resolver, also used by `DocsMarkdown`).
 *   - anything else → default `<code>` element (with `className` preserved
 *     so syntax-highlighting hints like `language-typescript` survive)
 *
 * Fenced code blocks reach this override too (react-markdown invokes the
 * `code` component for both); a multi-line block can't match the single-line
 * shortcut-token regex, so fenced blocks pass through naturally.
 *
 * Only `className` is forwarded — never spread `...rest`. react-markdown
 * passes internal props like `node` that aren't valid DOM attributes, and
 * spreading them produces React "Unknown prop" warnings.
 */
function MarkdownCode({
  children,
  className,
}: ComponentProps<'code'>): ReactNode {
  const text = typeof children === 'string' ? children : null
  if (text !== null) {
    const shortcut = resolveShortcutToken(text)
    if (shortcut !== null) return shortcut
  }
  return <code className={className}>{children}</code>
}

export function TipBody({ body }: TipBodyProps): ReactNode {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, tipSanitizeSchema]]}
        components={{ a: MarkdownLink, code: MarkdownCode }}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
