/**
 * Vite plugin: publish structured data as JSON at `/data/*` for agents/clients.
 *
 * Mirrors the prose plugin (build emits to `dist/data/`, dev/test serves the
 * same paths; a generated `/data/index.json` manifest lists the set). Two kinds
 * of entries:
 *   - file-backed: canonical `.json` authored in `src/content/data/`, served
 *     verbatim (FAQ, known issues, tips). Source == served.
 *   - generated: a projection computed from another source. `shortcuts.json` is
 *     projected from the keyboard registry to just the agent-facing fields
 *     (id/keys/label/section) — dropping the matcher and maintainer `note`.
 *
 * Adding a new served data file = add an entry below.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { getAllShortcuts } from '../src/shortcuts/registry'

const SOURCE_DIR = 'src/content/data'
const URL_BASE = '/data'

export interface DataManifestEntry {
  /** Served URL of the JSON file. */
  path: string
  /** One-line summary for the agent-facing manifest. */
  description: string
}

interface FileDataEntry {
  /** Filename in `src/content/data/`, e.g. `faq.json`. */
  name: string
  description: string
}

/** Canonical `.json` files in `src/content/data/`, served verbatim. */
const FILE_ENTRIES: FileDataEntry[] = [
  {
    name: 'faq.json',
    description: 'Frequently asked questions, grouped by section; each item is a question and a markdown answer.',
  },
  {
    name: 'known-issues.json',
    description:
      'Known issues and limitations, grouped by section; each has a status (expected-behavior / bug / limitation) and a markdown body.',
  },
  {
    name: 'tips.json',
    description: 'Product tips: short markdown guidance with categories, audience, and related docs.',
  },
  {
    name: 'tiers.json',
    description: 'Subscription tier limits (free/standard/pro) — item caps, content lengths, PATs, rate limits, AI quotas, and history retention.',
  },
]

/** Project the keyboard registry to the public, agent-facing shortcut shape. */
function projectShortcuts(): unknown {
  return getAllShortcuts().map((shortcut) => ({
    id: shortcut.id,
    keys: shortcut.keys,
    label: shortcut.label,
    section: shortcut.section,
  }))
}

/** Data served from a computed projection rather than a source file. */
const GENERATED_ENTRIES: { name: string; description: string; build: () => string }[] = [
  {
    name: 'shortcuts.json',
    description:
      'Keyboard shortcuts: id, OS-agnostic display keys (Mod/Alt/Shift, render Mod as ⌘ on Mac / Ctrl elsewhere), label, and section.',
    build: () => JSON.stringify(projectShortcuts(), null, 2),
  },
]

/**
 * Read/compute every served data payload. Exported so tests can assert the
 * served content + manifest without a running server.
 */
export function collectDataContent(root: string): {
  files: { name: string; content: string }[]
  manifest: DataManifestEntry[]
} {
  const fileItems = FILE_ENTRIES.map((entry) => ({
    name: entry.name,
    content: readFileSync(join(root, SOURCE_DIR, entry.name), 'utf-8'),
    description: entry.description,
  }))
  const generatedItems = GENERATED_ENTRIES.map((entry) => ({
    name: entry.name,
    content: entry.build(),
    description: entry.description,
  }))
  const items = [...fileItems, ...generatedItems]
  return {
    files: items.map(({ name, content }) => ({ name, content })),
    manifest: items.map(({ name, description }) => ({ path: `${URL_BASE}/${name}`, description })),
  }
}

export function dataContentPlugin(): Plugin {
  let root = process.cwd()
  return {
    name: 'tiddly:data-content',
    configResolved(config) {
      root = config.root
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0]
        if (url === undefined || !url.startsWith(`${URL_BASE}/`)) return next()

        const { files, manifest } = collectDataContent(root)
        if (url === `${URL_BASE}/index.json`) {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(manifest, null, 2))
          return
        }
        const name = url.slice(`${URL_BASE}/`.length)
        const file = files.find((f) => f.name === name)
        if (file === undefined) return next()
        res.setHeader('Content-Type', 'application/json')
        res.end(file.content)
        return
      })
    },
    generateBundle() {
      const { files, manifest } = collectDataContent(root)
      for (const { name, content } of files) {
        this.emitFile({ type: 'asset', fileName: `data/${name}`, source: content })
      }
      this.emitFile({
        type: 'asset',
        fileName: 'data/index.json',
        source: JSON.stringify(manifest, null, 2),
      })
    },
  }
}
