import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PROSE_DOCS, getProseDoc } from './proseDocs'
import { parseProseFile } from './frontmatter'
import { ProseDocPage } from '../pages/docs/ProseDocPage'
import { collectProseContent } from '../../plugins/proseContent'
import { KNOWN_ROUTE_PATHS, findMatchingRoute } from '../routePrefetch'
import { resolveTipShortcut } from '../data/tips/tipExtraShortcuts'
import { resolveInlineIcon } from '../components/markdown/inlineIcons'

/**
 * Public-content routes M1 is responsible for: every `/docs/*` page plus the
 * public legal pages. Anchored to the app's real route list (`KNOWN_ROUTE_PATHS`)
 * so a newly-added docs route can't escape the prose-coverage check by being
 * absent from a separate hand-list. Marketing pages (`/features`, `/pricing`, …)
 * are intentionally outside this guard — lower-priority prose, deferred to M4.
 */
const LEGAL_ROUTES = ['/privacy', '/terms']
const PUBLIC_CONTENT_ROUTES = [
  ...KNOWN_ROUTE_PATHS.filter((p) => p.startsWith('/docs')),
  ...LEGAL_ROUTES,
]

/**
 * Public-content routes that intentionally have NO `/prose/*.md` artifact, each
 * with the reason. Anything in `PUBLIC_CONTENT_ROUTES` must either have a prose
 * doc or appear here — so a deferral is recorded and visible, never silent.
 */
const EXCLUDED_FROM_PROSE: Record<string, string> = {
  // Navigation hubs: card-grid index pages (icons + links), app UI not prose
  // content. The pages they link to are individually prose, and /prose/index.json
  // is itself the agent-facing index, so excluding the hubs loses no content.
  '/docs': 'navigation hub (card-grid index UI)',
  '/docs/features': 'navigation hub (card-grid index UI)',
  '/docs/extensions': 'navigation hub (card-grid index UI)',
  '/docs/cli': 'navigation hub (card-grid index UI + quick-start widget)',
  // Structured-data views (M2): rendered from canonical JSON, not prose.
  '/docs/features/shortcuts': 'structured-data view → shortcuts.json (M2)',
  '/docs/tips': 'structured-data view → tips.json (M2)',
  '/docs/faq': 'structured data → /data/faq.json (M2)',
  '/docs/known-issues': 'structured data → known-issues.json (M2)',
  // Interactive widget / placeholder UI pages (not content prose).
  '/docs/ai': 'interactive AI-setup widget (owned by KAN-152)',
  '/docs/extensions/safari': 'placeholder "coming soon" UI page (not prose)',
  // Deferred prose.
  '/privacy': 'deferred-prose: legal page (M4)',
  '/terms': 'deferred-prose: legal page (M4)',
}

describe('prose registry', () => {
  it('loads every prose file with complete frontmatter and a body', () => {
    expect(PROSE_DOCS.length).toBeGreaterThan(0)
    for (const doc of PROSE_DOCS) {
      expect(doc.slug).toMatch(/^[a-z0-9-]+$/)
      expect(doc.route.startsWith('/')).toBe(true)
      expect(doc.title.length).toBeGreaterThan(0)
      expect(doc.description.length).toBeGreaterThan(0)
      expect(doc.body.trim().length).toBeGreaterThan(0)
      // The frontmatter block must be stripped from the rendered body.
      expect(doc.body.startsWith('---')).toBe(false)
    }
  })

  it('renders a registered page through ProseDocPage', () => {
    render(
      <MemoryRouter>
        <ProseDocPage slug="extensions-chrome" />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Chrome Extension' })).toBeInTheDocument()
  })

  it('throws for an unregistered slug', () => {
    expect(() => getProseDoc('does-not-exist')).toThrow(/No prose doc registered/)
  })
})

describe('prose content build output', () => {
  const root = process.cwd()
  const { files, manifest } = collectProseContent(root)

  it('emits one manifest entry per file, served as markdown under /prose', () => {
    expect(manifest.length).toBe(files.length)
    for (const entry of manifest) {
      expect(entry.path).toMatch(/^\/prose\/[a-z0-9-]+\.md$/)
      expect(entry.route.startsWith('/')).toBe(true)
      expect(entry.description.length).toBeGreaterThan(0)
    }
  })

  it('serves each file verbatim (round-trip equals the authored source)', () => {
    for (const { name, source } of files) {
      const onDisk = readFileSync(join(root, 'src/content/prose', name), 'utf-8')
      expect(source).toBe(onDisk)
    }
  })

  it('manifest stays in sync with the registry (same slugs)', () => {
    const manifestSlugs = manifest.map((e) => e.path.replace('/prose/', '').replace('.md', '')).sort()
    const registrySlugs = PROSE_DOCS.map((d) => d.slug).sort()
    expect(manifestSlugs).toEqual(registrySlugs)
  })

  it('served files parse as valid prose frontmatter', () => {
    for (const { name, source } of files) {
      expect(() => parseProseFile(source, name)).not.toThrow()
    }
  })

  it('uses the document H1 (not the browser-tab title) as the manifest title', () => {
    for (const { name, source } of files) {
      const { body } = parseProseFile(source, name)
      const h1 = /^#\s+(.+)$/m.exec(body)?.[1].trim()
      const entry = manifest.find((e) => e.path === `/prose/${name}`)
      expect(entry?.title).toBe(h1)
    }
  })
})

describe('prose inline tokens resolve (build-time guard)', () => {
  // Docs-prose `{{shortcut:id}}` / `{{icon:id}}` tokens are otherwise only
  // validated when their page renders. Walk every prose body so a mistyped id
  // fails the suite instead of shipping a token that crashes one page.
  it('every {{shortcut:id}} token in prose resolves to a real shortcut', () => {
    for (const doc of PROSE_DOCS) {
      for (const match of doc.body.matchAll(/\{\{shortcut:([^}]+)\}\}/g)) {
        expect(() => resolveTipShortcut(match[1]), `${doc.slug}: {{shortcut:${match[1]}}}`).not.toThrow()
      }
    }
  })

  it('every {{icon:id}} token in prose resolves to a real icon', () => {
    for (const doc of PROSE_DOCS) {
      for (const match of doc.body.matchAll(/\{\{icon:([^}]+)\}\}/g)) {
        expect(resolveInlineIcon(`{{icon:${match[1]}}}`), `${doc.slug}: {{icon:${match[1]}}}`).not.toBeNull()
      }
    }
  })
})

describe('prose coverage of public content routes', () => {
  const proseRoutes = new Set(PROSE_DOCS.map((d) => d.route))

  it('every public docs/legal route has a prose doc or a recorded exclusion', () => {
    const unaccounted = PUBLIC_CONTENT_ROUTES.filter(
      (path) => !proseRoutes.has(path) && !(path in EXCLUDED_FROM_PROSE),
    )
    expect(unaccounted).toEqual([])
  })

  it('no prose doc claims a route that is recorded as excluded', () => {
    const conflicts = PROSE_DOCS.filter((d) => d.route in EXCLUDED_FROM_PROSE).map((d) => d.slug)
    expect(conflicts).toEqual([])
  })

  it('every prose doc route resolves to a real app route (no typos/orphans)', () => {
    const orphans = PROSE_DOCS.filter((d) => findMatchingRoute(d.route) === undefined).map((d) => d.slug)
    expect(orphans).toEqual([])
  })

  it('every excluded route is a real public-content route (no stale exclusions)', () => {
    const stale = Object.keys(EXCLUDED_FROM_PROSE).filter((p) => !PUBLIC_CONTENT_ROUTES.includes(p))
    expect(stale).toEqual([])
  })
})
