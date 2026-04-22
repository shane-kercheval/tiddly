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
        Save bookmarks or search your collection from a tabbed popup. The extension auto-scrapes
        page metadata and captures content for full-text search. A regular webpage opens to the
        Save tab; a new tab or <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">chrome://</code> page
        opens to the Search tab. You can switch tabs manually at any time.
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
          className="btn-primary inline-flex items-center gap-2 mb-3"
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

      <StepSection step={3} title="Pin the Extension">
        <p className="text-sm text-gray-600">
          Click the{' '}
          <svg className="inline-block h-[1.1em] w-[1.1em] align-text-bottom" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h3a1 1 0 0 0 1-1v-1a2 2 0 0 1 4 0v1a1 1 0 0 0 1 1h3a1 1 0 0 1 1 1v3a1 1 0 0 0 1 1h1a2 2 0 0 1 0 4h-1a1 1 0 0 0-1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-1a2 2 0 0 0-4 0v1a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a2 2 0 0 0 0-4h-1a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1" />
          </svg>
          {' '}extensions icon in Chrome&apos;s toolbar, then click the{' '}
          <svg className="inline-block h-[1.1em] w-[1.1em] align-text-bottom" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
          </svg>
          {' '}pin icon next to <strong>Tiddly Bookmarks</strong> to add it to your toolbar.
        </p>
      </StepSection>

      <StepSection step={4} title="Configure the Extension">
        <p className="text-sm text-gray-600">
          Click the{' '}
          <svg className="inline-block h-[1.1em] w-[1.1em] align-text-bottom" viewBox="0 0 24 24" fill="none">
            <path stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
          </svg>
          {' '}Tiddly Bookmarks icon in your toolbar. On first launch you&apos;ll see a
          welcome screen — click <strong>Open Settings</strong>, paste your PAT, and optionally
          set default tags that will be pre-selected when saving.
        </p>
      </StepSection>

      {/* Saving Bookmarks */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Save Tab</h2>
        <p className="text-sm text-gray-600 mb-4">
          Click the extension icon on any webpage to open the popup. The Save tab is selected by
          default on regular pages, with a form pre-filled from the page:
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

      {/* Search Tab */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Search Tab</h2>
        <p className="text-sm text-gray-600 mb-4">
          Switch to Search from any page, or let the popup default to it on restricted pages
          like new tabs, <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">chrome://</code> pages,
          or other extension pages (where saving isn&apos;t possible — the Save tab is disabled
          on those).
        </p>
        <ul className="space-y-1.5 text-sm text-gray-600">
          <li>Browse your recent bookmarks sorted by creation date</li>
          <li>Type to search across titles, descriptions, URLs, and content</li>
          <li>Filter by tag and sort by created, relevance, last used, modified, or title</li>
          <li>Click a result to open it in a new tab</li>
          <li>Load more results with pagination</li>
        </ul>
      </div>

      {/* Tips */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-lg font-bold text-gray-900 mb-3">Tips</h2>
        <ul className="space-y-1.5 text-sm text-gray-600">
          <li>
            <strong>Default tags</strong> — set frequently used tags in the extension settings so they&apos;re
            pre-selected on every save (e.g., <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">reading-list</code>).
          </li>
          <li>
            <strong>Keyboard shortcut</strong> — assign a keyboard shortcut in{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">chrome://extensions/shortcuts</code>{' '}
            for even faster saving.
          </li>
        </ul>
      </div>
    </div>
  )
}
