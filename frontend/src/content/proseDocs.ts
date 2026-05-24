/**
 * Registry of prose docs/legal pages, sourced from the `.md` files in
 * `./prose`. This is the single source for prose content: the SPA renders these
 * bodies, and the same files are served verbatim at `/prose/*.md` for agents
 * (the build plugin in `plugins/proseContent.ts` emits them + a manifest).
 *
 * Pages look a page up by slug (the filename without extension) via `getProseDoc`.
 */
import { parseProseFile, type ProseFrontmatter } from './frontmatter'

export interface ProseDoc extends ProseFrontmatter {
  /** Filename without extension, e.g. `cli-mcp` for `cli-mcp.md`. */
  slug: string
  /** Markdown body with the frontmatter block stripped. */
  body: string
}

const rawFiles = import.meta.glob('./prose/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

function slugOf(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.md$/, '')
}

export const PROSE_DOCS: ProseDoc[] = Object.entries(rawFiles)
  .map(([path, raw]) => {
    const { data, body } = parseProseFile(raw, path)
    return { slug: slugOf(path), body, ...data }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug))

const BY_SLUG = new Map(PROSE_DOCS.map((doc) => [doc.slug, doc]))

export function getProseDoc(slug: string): ProseDoc {
  const doc = BY_SLUG.get(slug)
  if (doc === undefined) {
    throw new Error(`No prose doc registered for slug "${slug}"`)
  }
  return doc
}
