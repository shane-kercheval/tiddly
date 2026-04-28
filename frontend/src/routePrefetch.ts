/**
 * Route prefetching: triggers lazy chunk downloads on hover so they're cached before click.
 *
 * The routeImports map duplicates import paths from App.tsx. If an entry is missing,
 * the only consequence is no prefetch for that route — the lazy load still works normally.
 */
import { matchPathPrefix } from './utils/matchPathPrefix'

const routeImports: Record<string, () => Promise<unknown>> = {
  // Public pages (layout + page prefetched together)
  '/features': () => import('./pages/FeaturesPage'),
  '/privacy': () => import('./pages/PrivacyPolicy'),
  '/terms': () => import('./pages/TermsOfService'),
  '/changelog': () => { import('./components/PublicPageLayout').catch(() => {}); return import('./pages/changelog/Changelog') },
  '/roadmap': () => { import('./components/PublicPageLayout').catch(() => {}); return import('./pages/roadmap/Roadmap') },
  '/pricing': () => { import('./components/PublicPageLayout').catch(() => {}); return import('./pages/Pricing') },

  // Docs (layout co-prefetched with every page)
  '/docs': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsOverview') },
  '/docs/features': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsFeaturesHub') },
  '/docs/features/content-types': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsContentTypes') },
  '/docs/features/prompts': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsPrompts') },
  '/docs/features/tags-filters': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsTagsFilters') },
  '/docs/features/search': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsSearch') },
  '/docs/features/versioning': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsVersioning') },
  '/docs/features/shortcuts': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsShortcuts') },
  '/docs/ai': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAIHub') },
  '/docs/extensions': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsExtensionsHub') },
  '/docs/extensions/chrome': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsExtensionsChrome') },
  '/docs/extensions/safari': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsExtensionsSafari') },
  '/docs/api': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPI') },
  '/docs/faq': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsFAQ') },
  '/docs/known-issues': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsKnownIssues') },
  '/docs/tips': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsTips') },

  // App detail pages (heavy — CodeMirror + Milkdown)
  '/app/bookmarks': () => import('./pages/BookmarkDetail'),
  '/app/notes': () => import('./pages/NoteDetail'),
  '/app/prompts': () => import('./pages/PromptDetail'),

  // App settings pages
  '/app/settings/general': () => import('./pages/settings/SettingsGeneral'),
  '/app/settings/tokens': () => import('./pages/settings/SettingsTokens'),
  '/docs/features/ai': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAIFeatures') },
  '/app/settings/ai': () => import('./pages/settings/SettingsAI'),
  '/app/settings/ai-integration': () => import('./pages/settings/SettingsMCP'),
  '/app/settings/tags': () => import('./pages/settings/SettingsTags'),
  '/app/settings/faq': () => import('./pages/settings/SettingsFAQ'),
  '/app/settings/history': () => import('./pages/settings/SettingsVersionHistory'),
}

const routePrefixes = Object.keys(routeImports)

/**
 * Find the matching route key for a given path.
 * Exact match takes priority, then longest prefix match.
 * Returns undefined if no route matches.
 */
export function findMatchingRoute(path: string): string | undefined {
  return matchPathPrefix(path, routePrefixes)
}

/**
 * Trigger a prefetch of the JS chunk for a given route path.
 * Best-effort: errors are silently swallowed.
 */
export function prefetchRoute(path: string): void {
  const matched = findMatchingRoute(path)
  if (matched) {
    routeImports[matched]().catch(() => {})
  }
}
