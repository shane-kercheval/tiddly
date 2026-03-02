import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'

export function DocsTagsFilters(): ReactNode {
  usePageTitle('Docs - Tags & Filters')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Tags & Filters</h1>
      <p className="text-gray-600 mb-10">
        Tags let you organize content across all types. Saved filters combine tags into
        reusable views, and collections group filters in the sidebar.
      </p>

      {/* Tags */}
      <h2 className="text-xl font-bold text-gray-900 mb-3">Tags</h2>
      <p className="text-gray-600 mb-3">
        Tags are shared across bookmarks, notes, and prompts — a tag you create on a
        bookmark is the same tag available on notes and prompts.
      </p>
      <ul className="space-y-2 text-gray-600 mb-5">
        <li><strong>Global scope</strong> — one tag namespace across all content types</li>
        <li><strong>Case-insensitive</strong> — &quot;Python&quot; and &quot;python&quot; are the same tag</li>
        <li><strong>Autocomplete</strong> — start typing to see suggestions with usage counts</li>
        <li><strong>Inline editing</strong> — add and remove tags directly on any content item</li>
      </ul>

      <h3 className="text-base font-semibold text-gray-900 mb-2">Managing Tags</h3>
      <p className="text-gray-600 mb-2">
        Tags can be managed from <strong>Settings &gt; Tags</strong>:
      </p>
      <ul className="space-y-1.5 text-gray-600 mb-4">
        <li><strong>Rename</strong> — renames the tag globally across all content and filters</li>
        <li><strong>Delete</strong> — removes the tag from all content (doesn&#39;t delete the content itself)</li>
      </ul>
      <InfoCallout variant="warning">
        Tags used in saved filters can&#39;t be deleted until removed from those filters first.
        The app will show which filters depend on the tag.
      </InfoCallout>

      {/* Saved Filters */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Saved Filters</h2>
        <p className="text-gray-600 mb-4">
          Saved filters let you create reusable views based on tag combinations. Filters appear
          in the sidebar for quick access.
        </p>

        <h3 className="text-base font-semibold text-gray-900 mb-2">Filter Expressions</h3>
        <p className="text-gray-600 mb-3">
          Filters use boolean expressions built from tag groups:
        </p>
        <ul className="space-y-2 text-gray-600 mb-4">
          <li>
            <strong>AND groups</strong> — tags within a group are combined with AND
            (e.g. <em>python</em> AND <em>tutorial</em> matches items with both tags)
          </li>
          <li>
            <strong>OR between groups</strong> — groups are combined with OR
            (e.g. (<em>python</em> AND <em>tutorial</em>) OR (<em>javascript</em> AND <em>guide</em>))
          </li>
        </ul>
        <InfoCallout variant="tip">
          Use AND within groups for narrowing (must have all tags) and OR between groups for
          broadening (match any group).
        </InfoCallout>

        <h3 className="mt-6 text-base font-semibold text-gray-900 mb-2">Filter Options</h3>
        <ul className="space-y-1.5 text-gray-600 mb-5">
          <li><strong>Content type</strong> — restrict to bookmarks, notes, prompts, or any combination</li>
          <li><strong>Default sort</strong> — set a custom sort order (created date, updated date, title, etc.)</li>
          <li><strong>Name</strong> — displayed in the sidebar for quick identification</li>
        </ul>

        <h3 className="text-base font-semibold text-gray-900 mb-2">Default Filters</h3>
        <p className="text-gray-600">
          New accounts come with three default filters: <em>All Bookmarks</em>,{' '}
          <em>All Notes</em>, and <em>All Prompts</em> — each scoped to a single content type.
        </p>
      </div>

      {/* Collections */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Collections</h2>
        <p className="text-gray-600 mb-3">
          Collections group related filters together in the sidebar. Use them to organize
          filters by project, topic, or workflow.
        </p>
        <ul className="space-y-2 text-gray-600">
          <li><strong>Drag and drop</strong> — reorder filters and move them between collections</li>
          <li><strong>Collapsible</strong> — collapse collections to keep the sidebar tidy</li>
          <li><strong>Delete safely</strong> — deleting a collection moves its filters back to the sidebar root (doesn&#39;t delete the filters)</li>
        </ul>
      </div>

      {/* Sidebar Organization */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Sidebar Organization</h2>
        <p className="text-gray-600 mb-3">
          The sidebar shows your filters and collections alongside built-in views:
        </p>
        <ul className="space-y-1.5 text-gray-600 mb-4">
          <li><strong>All</strong> — everything (bookmarks + notes + prompts)</li>
          <li><strong>Archived</strong> — items you&#39;ve archived</li>
          <li><strong>Trash</strong> — soft-deleted items (recoverable for 30 days)</li>
          <li><strong>Filters</strong> — your saved filters and collections</li>
        </ul>
        <p className="text-gray-600">
          The entire sidebar order is persisted — drag items to arrange them however you like.
        </p>
      </div>
    </div>
  )
}
