import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'

function FieldList({ children }: { children: ReactNode }): ReactNode {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
      <ul className="space-y-1.5 text-sm text-gray-600">
        {children}
      </ul>
    </div>
  )
}

export function DocsContentTypes(): ReactNode {
  usePageTitle('Docs - Content Types')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Content Types</h1>
      <p className="text-gray-600 mb-10">
        Tiddly manages three content types — bookmarks, notes, and prompts — all organized
        with a shared tagging system and accessible from a unified interface.
      </p>

      {/* Bookmarks */}
      <h2 className="text-xl font-bold text-gray-900 mb-3">Bookmarks</h2>
      <p className="text-gray-600 mb-4">
        Save URLs with automatically scraped metadata. When you add a URL, Tiddly fetches the
        page title, description, and full article content so your bookmarks are searchable even
        if the original page goes offline.
      </p>
      <FieldList>
        <li><strong>URL</strong> — the page address (automatically normalized)</li>
        <li><strong>Title</strong> — auto-filled from the page, editable</li>
        <li><strong>Description</strong> — short summary, auto-filled from meta tags</li>
        <li><strong>Content</strong> — full page text extracted via article parser (also handles PDFs)</li>
        <li><strong>Tags</strong> — for organizing and filtering</li>
      </FieldList>

      <div className="mt-5 space-y-4 text-gray-600">
        <p>
          <strong className="text-gray-900">Quick Add:</strong>{' '}
          Copy a URL and press{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+V</code>{' '}
          anywhere in the app (when not focused on an input) to instantly create a bookmark
          with scraped metadata. You can also click the <strong>+</strong> button or use the{' '}
          <Link to="/docs/extensions" className="text-[#d97b3d] hover:underline">browser extension</Link>.
        </p>
        <p>
          <strong className="text-gray-900">Interaction:</strong>{' '}
          Clicking a bookmark&#39;s title opens the URL. Use the pencil icon to edit details.
          Hold <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Shift+Cmd+Click</code>{' '}
          to open a link without updating the &quot;last used&quot; timestamp.
        </p>
      </div>

      {/* Notes */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Notes</h2>
        <p className="text-gray-600 mb-4">
          Freeform markdown documents for capturing ideas, documentation, meeting notes, or
          anything else. Notes use a full-featured editor with formatting shortcuts and
          a rendered reading mode.
        </p>
        <FieldList>
          <li><strong>Title</strong> — the note name</li>
          <li><strong>Description</strong> — optional short summary</li>
          <li><strong>Content</strong> — markdown body</li>
          <li><strong>Tags</strong> — for organizing and filtering</li>
        </FieldList>

        <h3 className="mt-5 text-base font-semibold text-gray-900 mb-2">Editor Features</h3>
        <ul className="space-y-2 text-gray-600">
          <li>
            <strong>Slash commands</strong> — type{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">/</code> at the start
            of a line for headings, lists, code blocks, links, and more
          </li>
          <li>
            <strong>Command menu</strong> — press{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+/</code> for a
            filterable palette of all formatting options
          </li>
          <li>
            <strong>Reading mode</strong> — toggle with{' '}
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+Shift+M</code> to
            see rendered markdown preview
          </li>
          <li>
            <strong>Display options</strong> — toggle word wrap, line numbers, monospace font,
            and table of contents sidebar
          </li>
        </ul>
        <p className="mt-3 text-gray-600">
          See{' '}
          <Link to="/docs/features/shortcuts" className="text-[#d97b3d] hover:underline">
            Keyboard Shortcuts
          </Link>{' '}
          for the full list of editor formatting shortcuts.
        </p>
      </div>

      {/* Prompts */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Prompts</h2>
        <p className="text-gray-600 mb-4">
          Jinja2 templates designed for AI assistants. Define reusable prompt templates with
          typed arguments that can be rendered with different values, shared via MCP, or exported
          as agent skills.
        </p>
        <FieldList>
          <li><strong>Name</strong> — unique identifier (lowercase with hyphens, e.g. <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs">code-review</code>)</li>
          <li><strong>Title</strong> — human-readable display name</li>
          <li><strong>Description</strong> — usage guide for the template</li>
          <li><strong>Content</strong> — Jinja2 template body</li>
          <li><strong>Arguments</strong> — typed parameters with names, descriptions, and required flags</li>
          <li><strong>Tags</strong> — for organizing and filtering</li>
        </FieldList>
        <p className="mt-4 text-gray-600">
          See{' '}
          <Link to="/docs/features/prompts" className="text-[#d97b3d] hover:underline">
            Prompts & Templates
          </Link>{' '}
          for full details on Jinja2 syntax, arguments, and rendering.
        </p>
      </div>

      {/* Shared Features */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-4">Shared Features</h2>
        <p className="text-gray-600 mb-4">
          All three content types share these capabilities:
        </p>
        <ul className="space-y-2 text-gray-600 mb-6">
          <li>
            <strong>Tags</strong> — a global tag system shared across all content types.
            See{' '}
            <Link to="/docs/features/tags-filters" className="text-[#d97b3d] hover:underline">Tags & Filters</Link>.
          </li>
          <li>
            <strong>Version history</strong> — every edit is tracked with diffs and can be restored.
            See{' '}
            <Link to="/docs/features/versioning" className="text-[#d97b3d] hover:underline">Versioning</Link>.
          </li>
          <li>
            <strong>Linked content</strong> — link any item to any other item across types (e.g. link
            a note to a related bookmark).
          </li>
          <li>
            <strong>Archive & trash</strong> — archive items to hide them from default views, or
            soft-delete to trash with 30-day recovery.
          </li>
          <li>
            <strong>Full-text search</strong> — all fields are searchable.
            See{' '}
            <Link to="/docs/features/search" className="text-[#d97b3d] hover:underline">Search</Link>.
          </li>
        </ul>

        <InfoCallout variant="tip">
          All content types support optimistic locking — if someone else (or another tool via MCP)
          edits the same item while you&#39;re working on it, you&#39;ll see a conflict dialog
          with options to keep your version or load the latest.
        </InfoCallout>
      </div>
    </div>
  )
}
