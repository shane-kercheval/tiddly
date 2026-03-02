import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { Layout } from './components/Layout'
import { DocsLayout } from './components/DocsLayout'
import { PublicPageLayout } from './components/PublicPageLayout'
import { LandingPage } from './pages/LandingPage'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'
import { BookmarkDetail } from './pages/BookmarkDetail'
import { NoteDetail } from './pages/NoteDetail'
import { PromptDetail } from './pages/PromptDetail'
import { AllContent } from './pages/AllContent'
import { SettingsGeneral } from './pages/settings/SettingsGeneral'
import { SettingsTokens } from './pages/settings/SettingsTokens'
import { SettingsMCP } from './pages/settings/SettingsMCP'
import { SettingsTags } from './pages/settings/SettingsTags'
import { SettingsFAQ } from './pages/settings/SettingsFAQ'
import { SettingsVersionHistory } from './pages/settings/SettingsVersionHistory'
import { DocsOverview } from './pages/docs/DocsOverview'
import { DocsGettingStarted } from './pages/docs/DocsGettingStarted'
import { DocsAIHub } from './pages/docs/DocsAIHub'
import { DocsClaudeDesktop } from './pages/docs/DocsClaudeDesktop'
import { DocsClaudeCode } from './pages/docs/DocsClaudeCode'
import { DocsCodex } from './pages/docs/DocsCodex'
import { DocsAIChatGPT } from './pages/docs/DocsAIChatGPT'
import { DocsAIGeminiCLI } from './pages/docs/DocsAIGeminiCLI'
import { DocsAIMCPTools } from './pages/docs/DocsAIMCPTools'
import { DocsExtensionsHub } from './pages/docs/DocsExtensionsHub'
import { DocsExtensionsChrome } from './pages/docs/DocsExtensionsChrome'
import { DocsExtensionsSafari } from './pages/docs/DocsExtensionsSafari'
import { DocsAPI } from './pages/docs/DocsAPI'
import { DocsAPIEndpoint } from './pages/docs/DocsAPIEndpoint'
import { DocsFeaturesHub } from './pages/docs/DocsFeaturesHub'
import { DocsContentTypes } from './pages/docs/DocsContentTypes'
import { DocsPrompts } from './pages/docs/DocsPrompts'
import { DocsTagsFilters } from './pages/docs/DocsTagsFilters'
import { DocsSearch } from './pages/docs/DocsSearch'
import { DocsVersioning } from './pages/docs/DocsVersioning'
import { DocsShortcuts } from './pages/docs/DocsShortcuts'
import { DocsFAQ } from './pages/docs/DocsFAQ'
import { Changelog } from './pages/changelog/Changelog'
import { Roadmap } from './pages/roadmap/Roadmap'
import { Pricing } from './pages/Pricing'

/**
 * Root layout component that wraps the entire app with providers.
 */
function RootLayout(): ReactNode {
  return (
    <AuthProvider>
      <Toaster position="top-right" />
      <Outlet />
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
      { path: '/privacy', element: <PrivacyPolicy /> },
      { path: '/terms', element: <TermsOfService /> },

      // Public docs routes
      {
        element: <DocsLayout />,
        children: [
          { path: '/docs', element: <DocsOverview /> },
          { path: '/docs/getting-started', element: <DocsGettingStarted /> },
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
