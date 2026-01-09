import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
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
 *   - /app/content/lists/:listId : Custom list
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
  return (
    <BrowserRouter>
      <AuthProvider>
        <Toaster position="top-right" />
        <Routes>
          {/* Public routes */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/privacy" element={<PrivacyPolicy />} />
          <Route path="/terms" element={<TermsOfService />} />

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

                {/* Bookmark detail routes */}
                <Route path="/app/bookmarks/new" element={<BookmarkDetail />} />
                <Route path="/app/bookmarks/:id" element={<BookmarkDetail />} />

                {/* Note detail routes */}
                <Route path="/app/notes/new" element={<NoteDetail />} />
                <Route path="/app/notes/:id" element={<NoteDetail />} />

                {/* Prompt detail routes */}
                <Route path="/app/prompts/new" element={<PromptDetail />} />
                <Route path="/app/prompts/:id" element={<PromptDetail />} />

                {/* Settings routes */}
                <Route path="/app/settings" element={<Navigate to="/app/settings/general" replace />} />
                <Route path="/app/settings/general" element={<SettingsGeneral />} />
                <Route path="/app/settings/tokens" element={<SettingsTokens />} />
                <Route path="/app/settings/mcp" element={<SettingsMCP />} />
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
