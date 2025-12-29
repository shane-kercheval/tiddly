import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom'
import type { ReactNode } from 'react'
import { Toaster } from 'react-hot-toast'
import { AuthProvider } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/AppLayout'
import { Layout } from './components/Layout'
import { LandingPage } from './pages/LandingPage'
import { PrivacyPolicy } from './pages/PrivacyPolicy'
import { TermsOfService } from './pages/TermsOfService'
import { NoteDetail } from './pages/NoteDetail'
import { AllContent } from './pages/AllContent'
import { SettingsGeneral } from './pages/settings/SettingsGeneral'
import { SettingsTokens } from './pages/settings/SettingsTokens'
import { SettingsMCP } from './pages/settings/SettingsMCP'
import { SettingsTags } from './pages/settings/SettingsTags'
import { SettingsFAQ } from './pages/settings/SettingsFAQ'

/**
 * Redirect component for legacy list routes.
 * Properly substitutes :listId parameter into the new route.
 */
function ListRedirect(): ReactNode {
  const { listId } = useParams<{ listId: string }>()
  return <Navigate to={`/app/content/lists/${listId}`} replace />
}

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
 *   - /app : App container (redirects to /app/content)
 *   - /app/content : Unified view - all content (bookmarks + notes)
 *   - /app/content/archived : Unified view - archived content
 *   - /app/content/trash : Unified view - deleted content
 *   - /app/content/lists/:listId : Custom list (any content types)
 *   - /app/notes/new : Create new note
 *   - /app/notes/:id : View note
 *   - /app/notes/:id/edit : Edit note
 *   - /app/settings : Redirects to /app/settings/general
 *   - /app/settings/general : General UI preferences
 *   - /app/settings/tokens : Personal access tokens
 *   - /app/settings/mcp : MCP integration setup
 *   - /app/settings/tags : Tag management
 *   - /app/settings/faq : Frequently asked questions
 *
 * - Legacy redirects:
 *   - /bookmarks, /app/bookmarks/* : Redirects to /app/content
 *   - /app/notes (list views) : Redirects to /app/content
 *   - /settings : Redirects to /app/settings/general
 */
function App(): ReactNode {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />

          {/* Legacy redirects */}
          <Route path="/bookmarks" element={<Navigate to="/app/content" replace />} />
          <Route path="/bookmarks/*" element={<Navigate to="/app/content" replace />} />
          <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
          <Route path="/settings/*" element={<Navigate to="/app/settings/general" replace />} />

          {/* Protected app routes - requires auth + consent */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route element={<Layout />}>
                {/* /app root redirects to content */}
                <Route path="/app" element={<Navigate to="/app/content" replace />} />

                {/* Unified content routes (All, Archived, Trash, Lists) */}
                <Route path="/app/content" element={<AllContent />} />
                <Route path="/app/content/archived" element={<AllContent />} />
                <Route path="/app/content/trash" element={<AllContent />} />
                <Route path="/app/content/lists/:listId" element={<AllContent />} />

                {/* Legacy bookmark routes - redirect to unified content */}
                <Route path="/app/bookmarks" element={<Navigate to="/app/content" replace />} />
                <Route path="/app/bookmarks/archived" element={<Navigate to="/app/content/archived" replace />} />
                <Route path="/app/bookmarks/trash" element={<Navigate to="/app/content/trash" replace />} />
                <Route path="/app/bookmarks/lists/:listId" element={<ListRedirect />} />

                {/* Note detail routes */}
                <Route path="/app/notes/new" element={<NoteDetail />} />
                <Route path="/app/notes/:id" element={<NoteDetail />} />
                <Route path="/app/notes/:id/edit" element={<NoteDetail />} />

                {/* Legacy note list routes - redirect to unified content */}
                <Route path="/app/notes" element={<Navigate to="/app/content" replace />} />
                <Route path="/app/notes/archived" element={<Navigate to="/app/content/archived" replace />} />
                <Route path="/app/notes/trash" element={<Navigate to="/app/content/trash" replace />} />
                <Route path="/app/notes/lists/:listId" element={<ListRedirect />} />

                {/* Settings routes */}
                <Route path="/app/settings" element={<Navigate to="/app/settings/general" replace />} />
                <Route path="/app/settings/general" element={<SettingsGeneral />} />
                <Route path="/app/settings/tokens" element={<SettingsTokens />} />
                <Route path="/app/settings/mcp" element={<SettingsMCP />} />
                {/* Legacy redirects for removed settings pages */}
                <Route path="/app/settings/lists" element={<Navigate to="/app/settings/general" replace />} />
                <Route path="/app/settings/bookmarks" element={<Navigate to="/app/settings/general" replace />} />
                <Route path="/app/settings/tags" element={<SettingsTags />} />
                <Route path="/app/settings/faq" element={<SettingsFAQ />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
