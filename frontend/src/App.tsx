import { createBrowserRouter, RouterProvider, Navigate, Outlet } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { Layout } from './components/Layout'
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
