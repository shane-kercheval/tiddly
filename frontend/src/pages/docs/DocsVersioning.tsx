import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { InfoCallout } from './components/InfoCallout'

export function DocsVersioning(): ReactNode {
  usePageTitle('Docs - Versioning')

  return (
    <div>
      <h1 className="text-3xl font-bold text-gray-900 mb-4">Versioning</h1>
      <p className="text-gray-600 mb-10">
        Every change to your bookmarks, notes, and prompts is tracked. You can view the full
        history of an item, see what changed between versions, and restore to any previous version.
      </p>

      {/* What Gets Tracked */}
      <h2 className="text-xl font-bold text-gray-900 mb-4">What Gets Tracked</h2>
      <p className="text-gray-600 mb-4">
        Two types of actions are recorded:
      </p>

      <div className="space-y-4 mb-2">
        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-base font-semibold text-gray-900 mb-2">Content Versions</h3>
          <p className="text-sm text-gray-600 mb-2">
            Numbered versions (v1, v2, v3...) that track actual content changes:
          </p>
          <ul className="space-y-1 text-sm text-gray-600">
            <li><strong>Create</strong> — initial version when an item is created</li>
            <li><strong>Update</strong> — any edit to title, description, content, URL, tags, or arguments</li>
            <li><strong>Restore</strong> — restoring to a previous version creates a new version</li>
          </ul>
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-4">
          <h3 className="text-base font-semibold text-gray-900 mb-2">Audit Events</h3>
          <p className="text-sm text-gray-600 mb-2">
            Recorded for the audit trail but don&#39;t create content versions:
          </p>
          <ul className="space-y-1 text-sm text-gray-600">
            <li><strong>Delete / Undelete</strong> — moving to and from trash</li>
            <li><strong>Archive / Unarchive</strong> — archiving and restoring from archive</li>
          </ul>
        </div>
      </div>

      {/* History Sidebar */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">History Sidebar</h2>
        <p className="text-gray-600 mb-4">
          Open the history sidebar with{' '}
          <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm">Cmd+Shift+\</code>{' '}
          while viewing any item to see its full version history:
        </p>
        <ul className="space-y-2 text-gray-600">
          <li><strong>Version list</strong> — all versions with timestamps and action types</li>
          <li><strong>Change indicators</strong> — see which fields changed in each version (title, content, tags, etc.)</li>
          <li><strong>Source tracking</strong> — see where each change came from (web, MCP, API)</li>
          <li><strong>Inline diff</strong> — select a version to see the before/after content changes</li>
        </ul>
      </div>

      {/* Restoring */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Restoring a Version</h2>
        <p className="text-gray-600 mb-4">
          Click the restore button on any content version in the history sidebar. Restoring
          creates a <em>new</em> version — no history is lost. The restored content becomes the
          current version, and the restore action itself is recorded in the history.
        </p>
        <InfoCallout variant="info">
          Audit events (delete, archive) can&#39;t be &quot;restored&quot; — they represent
          lifecycle actions, not content states. Use the undelete or unarchive actions instead.
        </InfoCallout>
      </div>

      {/* Source Tracking */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Source Tracking</h2>
        <p className="text-gray-600 mb-4">
          Each history entry records where the change originated:
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 font-semibold text-gray-900">Source</th>
                <th className="py-2 font-semibold text-gray-900">Description</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">Web</td>
                <td className="py-2">Changes made through the Tiddly web app</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">MCP</td>
                <td className="py-2">Changes made by AI assistants via MCP servers</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">API</td>
                <td className="py-2">Changes made via Personal Access Tokens</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4 font-medium">iPhone</td>
                <td className="py-2">Changes made via the iOS shortcut</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Retention */}
      <div className="mt-10 border-t border-gray-200 pt-10">
        <h2 className="text-xl font-bold text-gray-900 mb-3">Retention</h2>
        <p className="text-gray-600 mb-4">
          Version history is retained based on your plan:
        </p>
        <div className="overflow-x-auto mb-5">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="py-2 pr-4 font-semibold text-gray-900">Plan</th>
                <th className="py-2 pr-4 font-semibold text-gray-900">Retention</th>
                <th className="py-2 font-semibold text-gray-900">Max Versions per Item</th>
              </tr>
            </thead>
            <tbody className="text-gray-600">
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4">Free</td>
                <td className="py-2 pr-4">3 days</td>
                <td className="py-2">100</td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="py-2 pr-4">Pro</td>
                <td className="py-2 pr-4">30 days</td>
                <td className="py-2">Unlimited</td>
              </tr>
            </tbody>
          </table>
        </div>
        <InfoCallout variant="tip">
          Items in the trash are permanently deleted after 30 days, along with their entire
          version history.
        </InfoCallout>
      </div>
    </div>
  )
}
