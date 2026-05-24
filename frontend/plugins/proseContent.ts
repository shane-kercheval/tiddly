/**
 * Vite plugin: publish prose `.md` files as static content at the web origin.
 *
 * Prose lives in `src/content/prose/*.md`. This plugin makes those files
 * fetchable as plain markdown so non-JS consumers (AI agents, future clients)
 * can read content the SPA renders client-side:
 *
 *   - build: emits each `.md` verbatim to `dist/prose/<name>.md` plus a generated
 *     `dist/prose/index.json` manifest (so an agent can discover the set — HTTP
 *     can't list a static directory).
 *   - dev/test: serves the same paths from the source dir, so local verification
 *     doesn't need a production build.
 *
 * Emitting to `dist/` (not the source-controlled `public/`) keeps the working
 * tree clean. The files are served as real static assets ahead of the SPA's
 * `index.html` fallback, so `/prose/foo.md` returns markdown, not the app shell.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { parseProseFile } from '../src/content/frontmatter'

const SOURCE_DIR = 'src/content/prose'
const URL_BASE = '/prose'

export interface ProseManifestEntry {
  /** Served URL of the markdown file. */
  path: string
  /** Human SPA route this file mirrors. */
  route: string
  title: string
  description: string
}

/**
 * Read every prose file and build the served payloads. Exported so tests can
 * assert the round-trip (served bytes == source file) without a running server.
 */
export function collectProseContent(root: string): {
  files: { name: string; source: string }[]
  manifest: ProseManifestEntry[]
} {
  const dir = join(root, SOURCE_DIR)
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .sort()
  const files = names.map((name) => ({ name, source: readFileSync(join(dir, name), 'utf-8') }))
  const manifest = files.map(({ name, source }) => {
    const { data, body } = parseProseFile(source, name)
    // The manifest is an agent-facing content index, so its title is the document's
    // `# H1` ("Chrome Extension"), not the browser-tab `title` frontmatter
    // ("Docs - Chrome Extension"). Fall back to the frontmatter title if a file has no H1.
    const h1 = /^#\s+(.+)$/m.exec(body)?.[1].trim()
    return {
      path: `${URL_BASE}/${name}`,
      route: data.route,
      title: h1 ?? data.title,
      description: data.description,
    }
  })
  return { files, manifest }
}

export function proseContentPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'tiddly:prose-content',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url === undefined || !url.startsWith(`${URL_BASE}/`)) return next()

        if (url === `${URL_BASE}/index.json`) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(collectProseContent(root).manifest, null, 2))
          return
        }
        if (url.endsWith('.md')) {
          const name = url.slice(`${URL_BASE}/`.length)
          if (name.includes('/') || name.includes('..')) return next()
          const file = join(root, SOURCE_DIR, name)
          if (!existsSync(file)) return next()
          res.setHeader('Content-Type', 'text/markdown; charset=utf-8')
          res.end(readFileSync(file, 'utf-8'))
          return
        }
        return next()
      })
    },
    generateBundle() {
      const { files, manifest } = collectProseContent(root)
      for (const { name, source } of files) {
        this.emitFile({ type: 'asset', fileName: `prose/${name}`, source })
      }
      this.emitFile({
        type: 'asset',
        fileName: 'prose/index.json',
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
