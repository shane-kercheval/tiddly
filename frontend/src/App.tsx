import { lazy, Suspense } from 'react'
import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { Layout } from './components/Layout'
import { LandingPage } from './pages/LandingPage'
import { AllContent } from './pages/AllContent'
import { LoadingSpinnerPage } from './components/ui'

// Lazy-loaded routes — keep in sync with routePrefetch.ts
// Lazy-loaded layouts (only used by lazy routes)
const DocsLayout = lazy(() => import('./components/DocsLayout').then(m => ({ default: m.DocsLayout })))
const PublicPageLayout = lazy(() => import('./components/PublicPageLayout').then(m => ({ default: m.PublicPageLayout })))

// Lazy-loaded detail pages (heavy — pulls in CodeMirror + Milkdown)
const BookmarkDetail = lazy(() => import('./pages/BookmarkDetail').then(m => ({ default: m.BookmarkDetail })))
const NoteDetail = lazy(() => import('./pages/NoteDetail').then(m => ({ default: m.NoteDetail })))
const PromptDetail = lazy(() => import('./pages/PromptDetail').then(m => ({ default: m.PromptDetail })))

// Lazy-loaded settings pages
const SettingsGeneral = lazy(() => import('./pages/settings/SettingsGeneral').then(m => ({ default: m.SettingsGeneral })))
const SettingsTokens = lazy(() => import('./pages/settings/SettingsTokens').then(m => ({ default: m.SettingsTokens })))
const SettingsMCP = lazy(() => import('./pages/settings/SettingsMCP').then(m => ({ default: m.SettingsMCP })))
const SettingsTags = lazy(() => import('./pages/settings/SettingsTags').then(m => ({ default: m.SettingsTags })))
const SettingsFAQ = lazy(() => import('./pages/settings/SettingsFAQ').then(m => ({ default: m.SettingsFAQ })))
const SettingsVersionHistory = lazy(() => import('./pages/settings/SettingsVersionHistory').then(m => ({ default: m.SettingsVersionHistory })))

// Lazy-loaded docs pages
const DocsOverview = lazy(() => import('./pages/docs/DocsOverview').then(m => ({ default: m.DocsOverview })))
const DocsAIHub = lazy(() => import('./pages/docs/DocsAIHub').then(m => ({ default: m.DocsAIHub })))
const DocsClaudeDesktop = lazy(() => import('./pages/docs/DocsClaudeDesktop').then(m => ({ default: m.DocsClaudeDesktop })))
const DocsClaudeCode = lazy(() => import('./pages/docs/DocsClaudeCode').then(m => ({ default: m.DocsClaudeCode })))
const DocsCodex = lazy(() => import('./pages/docs/DocsCodex').then(m => ({ default: m.DocsCodex })))
const DocsAIChatGPT = lazy(() => import('./pages/docs/DocsAIChatGPT').then(m => ({ default: m.DocsAIChatGPT })))
const DocsAIGeminiCLI = lazy(() => import('./pages/docs/DocsAIGeminiCLI').then(m => ({ default: m.DocsAIGeminiCLI })))
const DocsAIMCPTools = lazy(() => import('./pages/docs/DocsAIMCPTools').then(m => ({ default: m.DocsAIMCPTools })))
const DocsCLIHub = lazy(() => import('./pages/docs/DocsCLIHub').then(m => ({ default: m.DocsCLIHub })))
const DocsCLIAuth = lazy(() => import('./pages/docs/DocsCLIAuth').then(m => ({ default: m.DocsCLIAuth })))
const DocsCLIMCP = lazy(() => import('./pages/docs/DocsCLIMCP').then(m => ({ default: m.DocsCLIMCP })))
const DocsCLISkills = lazy(() => import('./pages/docs/DocsCLISkills').then(m => ({ default: m.DocsCLISkills })))
const DocsExtensionsHub = lazy(() => import('./pages/docs/DocsExtensionsHub').then(m => ({ default: m.DocsExtensionsHub })))
const DocsExtensionsChrome = lazy(() => import('./pages/docs/DocsExtensionsChrome').then(m => ({ default: m.DocsExtensionsChrome })))
const DocsExtensionsSafari = lazy(() => import('./pages/docs/DocsExtensionsSafari').then(m => ({ default: m.DocsExtensionsSafari })))
const DocsAPI = lazy(() => import('./pages/docs/DocsAPI').then(m => ({ default: m.DocsAPI })))
const DocsAPIEndpoint = lazy(() => import('./pages/docs/DocsAPIEndpoint').then(m => ({ default: m.DocsAPIEndpoint })))
const DocsFeaturesHub = lazy(() => import('./pages/docs/DocsFeaturesHub').then(m => ({ default: m.DocsFeaturesHub })))
const DocsContentTypes = lazy(() => import('./pages/docs/DocsContentTypes').then(m => ({ default: m.DocsContentTypes })))
const DocsPrompts = lazy(() => import('./pages/docs/DocsPrompts').then(m => ({ default: m.DocsPrompts })))
const DocsTagsFilters = lazy(() => import('./pages/docs/DocsTagsFilters').then(m => ({ default: m.DocsTagsFilters })))
const DocsSearch = lazy(() => import('./pages/docs/DocsSearch').then(m => ({ default: m.DocsSearch })))
const DocsVersioning = lazy(() => import('./pages/docs/DocsVersioning').then(m => ({ default: m.DocsVersioning })))
const DocsShortcuts = lazy(() => import('./pages/docs/DocsShortcuts').then(m => ({ default: m.DocsShortcuts })))
const DocsFAQ = lazy(() => import('./pages/docs/DocsFAQ').then(m => ({ default: m.DocsFAQ })))

// Lazy-loaded public pages
const FeaturesPage = lazy(() => import('./pages/FeaturesPage').then(m => ({ default: m.FeaturesPage })))
const Pricing = lazy(() => import('./pages/Pricing').then(m => ({ default: m.Pricing })))
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then(m => ({ default: m.PrivacyPolicy })))
const TermsOfService = lazy(() => import('./pages/TermsOfService').then(m => ({ default: m.TermsOfService })))
const Changelog = lazy(() => import('./pages/changelog/Changelog').then(m => ({ default: m.Changelog })))
const Roadmap = lazy(() => import('./pages/roadmap/Roadmap').then(m => ({ default: m.Roadmap })))

/**
 * Root layout component that wraps the entire app with providers.
 */
function RootLayout(): ReactNode {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <Suspense fallback={<LoadingSpinnerPage />}>
        <Outlet />
      </Suspense>
    </AuthProvider>
  )
}

/**
 * Router configuration using createBrowserRouter for data router features.
 * This enables useBlocker and other data router hooks.
 */
const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      // Public routes
      { path: '/', element: <LandingPage /> },
      { path: '/features', element: <FeaturesPage /> },
      { path: '/privacy', element: <PrivacyPolicy /> },
      { path: '/terms', element: <TermsOfService /> },

      // Public docs routes
      {
        element: <DocsLayout />,
        children: [
          { path: '/docs', element: <DocsOverview /> },
          { path: '/docs/features', element: <DocsFeaturesHub /> },
          { path: '/docs/features/content-types', element: <DocsContentTypes /> },
          { path: '/docs/features/prompts', element: <DocsPrompts /> },
          { path: '/docs/features/tags-filters', element: <DocsTagsFilters /> },
          { path: '/docs/features/search', element: <DocsSearch /> },
          { path: '/docs/features/versioning', element: <DocsVersioning /> },
          { path: '/docs/features/shortcuts', element: <DocsShortcuts /> },
          { path: '/docs/ai', element: <DocsAIHub /> },
          { path: '/docs/ai/claude-desktop', element: <DocsClaudeDesktop /> },
          { path: '/docs/ai/claude-code', element: <DocsClaudeCode /> },
          { path: '/docs/ai/codex', element: <DocsCodex /> },
          { path: '/docs/ai/chatgpt', element: <DocsAIChatGPT /> },
          { path: '/docs/ai/gemini-cli', element: <DocsAIGeminiCLI /> },
          { path: '/docs/ai/mcp-tools', element: <DocsAIMCPTools /> },
          { path: '/docs/cli', element: <DocsCLIHub /> },
          { path: '/docs/cli/authentication', element: <DocsCLIAuth /> },
          { path: '/docs/cli/mcp', element: <DocsCLIMCP /> },
          { path: '/docs/cli/skills', element: <DocsCLISkills /> },
          { path: '/docs/extensions', element: <DocsExtensionsHub /> },
          { path: '/docs/extensions/chrome', element: <DocsExtensionsChrome /> },
          { path: '/docs/extensions/safari', element: <DocsExtensionsSafari /> },
          { path: '/docs/api', element: <DocsAPI /> },
          { path: '/docs/api/:endpoint', element: <DocsAPIEndpoint /> },
          { path: '/docs/faq', element: <DocsFAQ /> },
        ],
      },

      // Top-level public routes with shared header/footer
      {
        element: <PublicPageLayout />,
        children: [
          { path: '/changelog', element: <Changelog /> },
          { path: '/roadmap', element: <Roadmap /> },
          { path: '/pricing', element: <Pricing /> },
        ],
      },

      // Protected app routes - requires auth + consent
      {
        element: <ProtectedRoute />,
        children: [
          {
            element: <AppLayout />,
            children: [
              {
                element: <Layout />,
                children: [
                  // /app root redirects to content
                  { path: '/app', element: <Navigate to="/app/content" replace /> },

                  // Unified content routes (All, Archived, Trash, Filters)
                  { path: '/app/content', element: <AllContent /> },
                  { path: '/app/content/archived', element: <AllContent /> },
                  { path: '/app/content/trash', element: <AllContent /> },
                  { path: '/app/content/filters/:filterId', element: <AllContent /> },

                  // Bookmark detail routes
                  { path: '/app/bookmarks/new', element: <BookmarkDetail /> },
                  { path: '/app/bookmarks/:id', element: <BookmarkDetail /> },

                  // Note detail routes
                  { path: '/app/notes/new', element: <NoteDetail /> },
                  { path: '/app/notes/:id', element: <NoteDetail /> },

                  // Prompt detail routes
                  { path: '/app/prompts/new', element: <PromptDetail /> },
                  { path: '/app/prompts/:id', element: <PromptDetail /> },

                  // Settings routes
                  { path: '/app/settings', element: <Navigate to="/app/settings/general" replace /> },
                  { path: '/app/settings/general', element: <SettingsGeneral /> },
                  { path: '/app/settings/tokens', element: <SettingsTokens /> },
                  { path: '/app/settings/mcp', element: <SettingsMCP /> },
                  { path: '/app/settings/tags', element: <SettingsTags /> },
                  { path: '/app/settings/history', element: <SettingsVersionHistory /> },
                  { path: '/app/settings/faq', element: <SettingsFAQ /> },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
])

/**
 * Main application component with routing configuration.
 *
 * Route structure:
 * - Public routes (no auth required):
 *   - / : Landing page
 *   - /privacy : Privacy Policy
 *   - /terms : Terms of Service
 *   - /docs/* : Documentation pages
 *   - /changelog : Changelog
 *   - /roadmap : Roadmap
 *
 * - App routes (authentication + consent required):
 *   - /app : Redirects to /app/content
 *   - /app/content : Unified view - all content (bookmarks + notes + prompts)
 *   - /app/content/archived : Archived content
 *   - /app/content/trash : Deleted content
 *   - /app/content/filters/:filterId : Custom filter
 *   - /app/bookmarks/new : Create new bookmark
 *   - /app/bookmarks/:id : View/edit bookmark (unified component)
 *   - /app/notes/new : Create new note
 *   - /app/notes/:id : View/edit note (unified component)
 *   - /app/prompts/new : Create new prompt
 *   - /app/prompts/:id : View/edit prompt (unified component)
 *   - /app/settings : Redirects to /app/settings/general
 *   - /app/settings/general : General UI preferences
 *   - /app/settings/tokens : Personal access tokens
 *   - /app/settings/mcp : MCP integration setup
 *   - /app/settings/tags : Tag management
 *   - /app/settings/faq : Frequently asked questions
 */
function App(): ReactNode {
  return <RouterProvider router={router} />
}

export default App
