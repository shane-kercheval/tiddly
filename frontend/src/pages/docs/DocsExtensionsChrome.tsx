import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { StepSection } from './components/StepSection'
import { InfoCallout } from './components/InfoCallout'

const CHROME_STORE_URL = 'https://chrome.google.com/webstore/detail/npjlfgkihebhandkknldnjlcdmcpomkc'

export function DocsExtensionsChrome(): ReactNode {
  usePageTitle('Docs - Chrome Extension')

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Chrome Extension</h1>
      <p className="text-sm text-gray-600 mb-8">
        Save bookmarks to Tiddly with one click from any webpage. The extension auto-scrapes
        page metadata and captures content for full-text search.
      </p>

      {/* Setup */}
      <h2 className="text-lg font-bold text-gray-900 mb-4">Setup</h2>

      <StepSection step={1} title="Install the Extension">
        <p className="text-sm text-gray-600 mb-3">
          Install from the{' '}
          <a
            href={CHROME_STORE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#d97b3d] hover:underline"
          >
            Chrome Web Store
          </a>
          . Works in Chrome, Edge, Brave, Arc, and other Chromium-based browsers.
        </p>
      </StepSection>

      <StepSection step={2} title="Create a Personal Access Token">
        <p className="text-sm text-gray-600 mb-3">
          The extension authenticates with a Personal Access Token (PAT).
        </p>
        <a
          href="/app/settings/tokens"
          className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 mb-3"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Create Token
        </a>
        <InfoCallout variant="tip">
          Give the token a descriptive name like &quot;Chrome Extension&quot; so you can identify it later.
        </InfoCallout>
      </StepSection>

      <StepSection step={3} title="Configure the Extension">
        <p className="text-sm text-gray-600 mb-3">
          Right-click the extension icon and select <strong>Options</strong> (or click the gear icon in the popup).
          Paste your PAT and optionally set default tags that will be pre-selected when saving.
        </p>
      </StepSection>

      {/* Saving Bookmarks */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Saving Bookmarks</h2>
        <p className="text-sm text-gray-600 mb-4">
          Click the extension icon on any webpage to open the save popup. The form is
          pre-filled with data extracted from the page:
        </p>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 mb-4">
          <ul className="space-y-2 text-sm text-gray-600">
            <li><strong>URL</strong> — current page URL</li>
            <li><strong>Title</strong> — from the page title or Open Graph tags</li>
            <li><strong>Description</strong> — from meta description or Open Graph tags</li>
            <li><strong>Page content</strong> — body text captured for full-text search (up to 25,000 characters)</li>
            <li><strong>Tags</strong> — pre-selected from your default tags and recently used tags</li>
          </ul>
        </div>

        <p className="text-sm text-gray-600 mb-3">
          Review and edit any field, then click <strong>Save Bookmark</strong>. You can select
          additional tags from your existing tags shown as chips below the tag input.
        </p>

        <InfoCallout variant="info">
          If a bookmark with the same URL already exists (active or archived), you&apos;ll see a message
          with a link to the existing bookmark instead of creating a duplicate.
        </InfoCallout>
      </div>

      {/* Search Mode */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Search Mode</h2>
        <p className="text-sm text-gray-600 mb-4">
          On restricted pages where saving isn&apos;t possible — like new tab, <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">chrome://</code> pages,
          or other extension pages — the popup automatically switches to search mode.
        </p>
        <ul className="space-y-1.5 text-sm text-gray-600">
          <li>Browse your recent bookmarks sorted by creation date</li>
          <li>Type to search across titles, descriptions, URLs, and content</li>
          <li>Click a result to open it in a new tab</li>
          <li>Load more results with pagination</li>
        </ul>
      </div>

      {/* Tips */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Tips</h2>
        <ul className="space-y-1.5 text-sm text-gray-600">
          <li>
            <strong>Default tags</strong> — set frequently used tags in Options so they&apos;re pre-selected
            on every save (e.g., <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">reading-list</code>).
          </li>
          <li>
            <strong>Keyboard shortcut</strong> — assign a keyboard shortcut in{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">chrome://extensions/shortcuts</code>{' '}
            for even faster saving.
          </li>
          <li>
            <strong>Pin the extension</strong> — click the puzzle piece icon in Chrome&apos;s toolbar and
            pin Tiddly for one-click access.
          </li>
        </ul>
      </div>
    </div>
  )
}
