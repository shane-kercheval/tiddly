/**
 * Thin renderer for a prose docs/legal page: looks the page up in the prose
 * registry by slug, sets the browser title, and renders its markdown body.
 *
 * The legacy per-page TSX components are now one-liners that delegate here, so
 * the page content lives in `src/content/prose/<slug>.md` (the single source)
 * rather than in JSX.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { DocsMarkdown } from '../../components/markdown/DocsMarkdown'
import { getProseDoc } from '../../content/proseDocs'

export function ProseDocPage({ slug }: { slug: string }): ReactNode {
  const doc = getProseDoc(slug)
  usePageTitle(doc.title)
  return <DocsMarkdown body={doc.body} />
}
