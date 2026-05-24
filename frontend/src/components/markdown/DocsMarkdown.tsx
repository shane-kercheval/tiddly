/**
 * Shared renderer for docs/legal prose authored as markdown.
 *
 * This is the single rendering path for the `.md` files under `src/content/prose`
 * (the same files served at `/prose/*.md` for agents). It exists so prose has one
 * source — the markdown — rather than the hand-maintained JSX it replaces.
 *
 * Built on `react-markdown` (NOT MDX): MDX would compile markdown-with-JSX into a
 * module and force a generated, stripped `.md` emit — the drift this refactor
 * removes. `react-markdown` renders the markdown *string* at runtime, so the file
 * authored is byte-identical to the file served.
 *
 * The `components` map lowers the legacy presentational helpers to markdown:
 *   - fenced code  → `CopyableCodeBlock` (copy button; `jinja` highlighting via the
 *                    fence language ```jinja)
 *   - `> [!variant]` blockquote → `InfoCallout`-styled callout (see `remarkCallouts`)
 *   - links        → router `<Link>` for internal paths (SPA navigation)
 *   - `` `{{icon:id}}` `` inline code → inline icon component (see `inlineIcons`)
 */
import type { ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components } from 'react-markdown'
import { Link } from 'react-router-dom'
import remarkGfm from 'remark-gfm'
import rehypeSanitize from 'rehype-sanitize'
import { CopyableCodeBlock } from '../../pages/docs/components/CopyableCodeBlock'
import { VARIANT_STYLES, type CalloutVariant } from '../../pages/docs/components/calloutStyles'
import { remarkCallouts } from './remarkCallouts'
import { docsSanitizeSchema } from './docsSanitizeSchema'
import { resolveInlineIcon } from './inlineIcons'

/** Minimal shape of the hast nodes `react-markdown` passes to component overrides. */
interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

function nodeText(node: HastNode | undefined): string {
  if (node === undefined) return ''
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(nodeText).join('')
}

function languageOf(node: HastNode | undefined): string | undefined {
  const className = node?.properties?.className
  const classes = Array.isArray(className) ? className.map(String) : []
  return classes.find((c) => c.startsWith('language-'))?.slice('language-'.length)
}

function firstElementChild(node: HastNode | undefined): HastNode | undefined {
  return node?.children?.find((c) => !(c.type === 'text' && (c.value ?? '').trim() === ''))
}

/** A list item "leads with a bold title" when its first content is `<strong>` (tight) or a `<p>` starting with `<strong>` (loose). */
function itemLeadsWithStrong(li: HastNode): boolean {
  const first = firstElementChild(li)
  if (first === undefined) return false
  if (first.tagName === 'strong') return true
  if (first.tagName === 'p') return firstElementChild(first)?.tagName === 'strong'
  return false
}

/**
 * An ordered list renders as numbered "step cards" (orange number + bordered box,
 * the legacy `StepSection` look) when *every* item begins with a bold title — the
 * setup-guide shape. Plain ordered lists (e.g. rebind steps that don't lead with
 * bold) render normally. The source stays a plain ordered list, agent-readable.
 */
function isStepsList(node: HastNode | undefined): boolean {
  const items = (node?.children ?? []).filter((c) => c.tagName === 'li')
  return items.length > 0 && items.every(itemLeadsWithStrong)
}

// Brand-orange docs link, matching the legacy `text-[#d97b3d] hover:underline`
// used across the hand-written docs pages: orange, underline on hover only.
const LINK_CLASS = 'text-[#d97b3d] no-underline hover:underline'

// Inline-code "chip", matching the legacy
// `<code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">`.
const INLINE_CODE_CLASS = 'rounded bg-gray-100 px-1.5 py-0.5 text-sm font-normal'

/**
 * Internal links (`/path`) become SPA `<Link>`s; in-page anchors stay plain;
 * external links open in a new tab. Mirrors `TipBody`'s link handling.
 */
function MarkdownLink({ href, children }: { href?: string; children?: ReactNode }): ReactNode {
  if (href === undefined) return <a className={LINK_CLASS}>{children}</a>
  if (href.startsWith('/')) return <Link to={href} className={LINK_CLASS}>{children}</Link>
  if (href.startsWith('#')) return <a href={href} className={LINK_CLASS}>{children}</a>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={LINK_CLASS}>
      {children}
    </a>
  )
}

const components: Components = {
  // Fenced code blocks. We read the raw code from the hast node rather than the
  // rendered children so the inline `code` override below only ever sees inline
  // spans. `pre`'s children are intentionally ignored.
  pre({ node }) {
    const codeNode = (node as HastNode | undefined)?.children?.find(
      (c) => c.type === 'element' && c.tagName === 'code',
    )
    const language = languageOf(codeNode)
    return (
      <CopyableCodeBlock
        code={nodeText(codeNode).replace(/\n$/, '')}
        language={language}
        jinja={language === 'jinja'}
      />
    )
  },
  // Inline code: an `{{icon:id}}` token renders its icon; everything else is a
  // normal inline `<code>` (className preserved for any language hint).
  code({ children, className }) {
    const text = typeof children === 'string' ? children : null
    if (text !== null) {
      const icon = resolveInlineIcon(text)
      if (icon !== null) return icon
    }
    return <code className={`${INLINE_CODE_CLASS}${className ? ` ${className}` : ''}`}>{children}</code>
  },
  a: MarkdownLink,
  ul({ children }) {
    return <ul className="mb-4 space-y-1.5 list-disc list-outside pl-5">{children}</ul>
  },
  // An all-bold-led ordered list becomes step cards (`.docs-steps`, styled in
  // index.css with a CSS counter for the number); otherwise a normal numbered list.
  ol({ node, children }) {
    if (isStepsList(node as HastNode)) {
      return <ol className="docs-steps">{children}</ol>
    }
    return <ol className="mb-4 space-y-1.5 list-decimal list-outside pl-5">{children}</ol>
  },
  // Alert blockquotes (`> [!variant]`) carry a `callout callout-<variant>` class
  // from `remarkCallouts`; render them with the shared `InfoCallout` styling.
  blockquote({ children, className }) {
    const variant = (['info', 'tip', 'warning'] as CalloutVariant[]).find((v) =>
      (className ?? '').includes(`callout-${v}`),
    )
    if (variant === undefined) return <blockquote>{children}</blockquote>
    // `[&>:first-child]:mt-0 [&>:last-child]:mb-0` drops the wrapper's paragraph
    // margins on the callout's first/last child so they don't stack with the
    // box's own `p-4` padding — matching the tight legacy `<InfoCallout>` spacing.
    return (
      <div
        className={`callout callout-${variant} my-4 rounded-lg border p-4 text-sm [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${VARIANT_STYLES[variant]}`}
      >
        {children}
      </div>
    )
  },
}

/**
 * Element styling for docs prose.
 *
 * The legacy docs pages were NOT `prose`-wrapped — each used hand-tuned Tailwind
 * classes (`text-sm text-gray-600` body, `text-gray-900` headings on a 2xl/lg/base
 * scale, bulletless `space-y` "term — description" lists, `border-t` section
 * dividers). We replicate that here with element selectors rather than leaning on
 * `@tailwindcss/typography`, whose defaults (type scale, link underline, paragraph
 * margins, backtick-quoted inline code) diverge from the originals. `a`, `code`,
 * `pre`, and `blockquote` styling lives in the `components` map above; everything
 * structural is here.
 */
const DOCS_PROSE_STYLES = [
  'max-w-none text-sm text-gray-600',
  '[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:text-gray-900 [&_h1]:mb-4',
  '[&_h2]:text-lg [&_h2]:font-bold [&_h2]:text-gray-900 [&_h2]:mb-3',
  '[&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-gray-900 [&_h3]:mt-6 [&_h3]:mb-2',
  '[&_h4]:font-semibold [&_h4]:text-gray-900 [&_h4]:mt-4 [&_h4]:mb-2',
  // Section dividers: a rule above every h2 except the first.
  '[&_h2]:mt-10 [&_h2]:border-t [&_h2]:border-gray-200 [&_h2]:pt-10',
  '[&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:border-t-0 [&_h2:first-of-type]:pt-0',
  '[&_p]:mb-3',
  // Lists are styled by the `ul`/`ol` components (ordered lists may become step
  // cards), so no list rules here.
  // GFM tables.
  '[&_table]:my-4 [&_table]:w-full [&_table]:text-sm',
  '[&_th]:border-b [&_th]:border-gray-200 [&_th]:py-2 [&_th]:pr-4 [&_th]:text-left [&_th]:font-semibold [&_th]:text-gray-900',
  '[&_td]:border-b [&_td]:border-gray-100 [&_td]:py-2 [&_td]:pr-4 [&_td]:align-top',
  '[&_hr]:my-8 [&_hr]:border-gray-200',
].join(' ')

export function DocsMarkdown({ body }: { body: string }): ReactNode {
  return (
    <div className={DOCS_PROSE_STYLES}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkCallouts]}
        rehypePlugins={[[rehypeSanitize, docsSanitizeSchema]]}
        components={components}
      >
        {body}
      </ReactMarkdown>
    </div>
  )
}
