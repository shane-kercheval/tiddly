/**
 * Route prefetching: triggers lazy chunk downloads on hover so they're cached before click.
 *
 * The routeImports map duplicates import paths from App.tsx. If an entry is missing,
 * the only consequence is no prefetch for that route — the lazy load still works normally.
 */

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
  '/docs/ai/claude-desktop': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsClaudeDesktop') },
  '/docs/ai/claude-code': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsClaudeCode') },
  '/docs/ai/codex': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsCodex') },
  '/docs/ai/chatgpt': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAIChatGPT') },
  '/docs/ai/gemini-cli': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAIGeminiCLI') },
  '/docs/ai/mcp-tools': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAIMCPTools') },
  '/docs/extensions': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsExtensionsHub') },
  '/docs/extensions/chrome': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsExtensionsChrome') },
  '/docs/extensions/safari': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsExtensionsSafari') },
  '/docs/api': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPI') },
  '/docs/api/bookmarks': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPIEndpoint') },
  '/docs/api/notes': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPIEndpoint') },
  '/docs/api/prompts': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPIEndpoint') },
  '/docs/api/content': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPIEndpoint') },
  '/docs/api/tags': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPIEndpoint') },
  '/docs/api/history': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsAPIEndpoint') },
  '/docs/faq': () => { import('./components/DocsLayout').catch(() => {}); return import('./pages/docs/DocsFAQ') },

  // App detail pages (heavy — CodeMirror + Milkdown)
  '/app/bookmarks': () => import('./pages/BookmarkDetail'),
  '/app/notes': () => import('./pages/NoteDetail'),
  '/app/prompts': () => import('./pages/PromptDetail'),

  // App settings pages
  '/app/settings/general': () => import('./pages/settings/SettingsGeneral'),
  '/app/settings/tokens': () => import('./pages/settings/SettingsTokens'),
  '/app/settings/mcp': () => import('./pages/settings/SettingsMCP'),
  '/app/settings/tags': () => import('./pages/settings/SettingsTags'),
  '/app/settings/faq': () => import('./pages/settings/SettingsFAQ'),
  '/app/settings/history': () => import('./pages/settings/SettingsVersionHistory'),
}

// Pre-sort keys by length descending for longest-prefix matching
const sortedPrefixes = Object.keys(routeImports).sort((a, b) => b.length - a.length)

/**
 * Find the matching route key for a given path.
 * Exact match takes priority, then longest prefix match.
 * Returns undefined if no route matches.
 */
export function findMatchingRoute(path: string): string | undefined {
  // Strip query string and hash
  const cleanPath = path.split('?')[0].split('#')[0]

  // Exact match first
  if (routeImports[cleanPath]) return cleanPath

  // Longest prefix match
  for (const prefix of sortedPrefixes) {
    if (cleanPath.startsWith(prefix + '/') || cleanPath === prefix) {
      return prefix
    }
  }

  return undefined
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
