/**
 * Known Issues docs page.
 *
 * Documents known behaviors, limitations, and planned improvements.
 * Each issue is classified by type to set expectations.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { DocsSection } from './components/DocsSection'

type IssueStatus = 'expected-behavior' | 'bug' | 'limitation'

interface StatusBadgeProps {
  status: IssueStatus
}

const statusConfig: Record<IssueStatus, { label: string; className: string }> = {
  'expected-behavior': {
    label: 'Expected Behavior',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  'bug': {
    label: 'Bug',
    className: 'bg-red-50 text-red-700 border-red-200',
  },
  'limitation': {
    label: 'Current Limitation',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
}

function StatusBadge({ status }: StatusBadgeProps): ReactNode {
  const config = statusConfig[status]
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full border ${config.className}`}>
      {config.label}
    </span>
  )
}

interface KnownIssueProps {
  title: string
  status: IssueStatus
  children: ReactNode
}

function KnownIssue({ title, status, children }: KnownIssueProps): ReactNode {
  return (
    <div className="border-b border-gray-100 py-5 last:border-b-0">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-base font-medium text-gray-900">{title}</h3>
        <StatusBadge status={status} />
      </div>
      <div className="text-sm text-gray-600 space-y-2">{children}</div>
    </div>
  )
}


export function DocsKnownIssues(): ReactNode {
  usePageTitle('Docs - Known Issues')
  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-4">Known Issues</h1>
      <p className="text-sm text-gray-600 mb-4">
        Documented behaviors and known bugs. Each item is classified to set expectations:
      </p>
      <table className="text-sm text-gray-600 mb-8 border-separate border-spacing-y-1.5">
        <tbody>
          <tr><td className="pr-3"><StatusBadge status="expected-behavior" /></td><td>Working as designed, not a bug</td></tr>
          <tr><td className="pr-3"><StatusBadge status="limitation" /></td><td>Known constraint, not a bug</td></tr>
          <tr><td className="pr-3"><StatusBadge status="bug" /></td><td>Known bug</td></tr>
        </tbody>
      </table>

      <DocsSection title="Content">
        <KnownIssue title="Text-only content — no image or file attachments" status="limitation">
          <p>
            Bookmarks, notes, and prompts currently support text content only. You cannot upload
            or attach images, PDFs, or other files. Markdown image syntax (e.g.,{' '}
            <code className="bg-gray-100 px-1 rounded">![alt](url)</code>) works for referencing
            externally hosted images, but there is no built-in file hosting.
          </p>
        </KnownIssue>
      </DocsSection>

      <DocsSection title="Editor">
        <KnownIssue title="Extra line break when continuing loose lists" status="expected-behavior">
          <p>
            When a markdown list has blank lines between items (a "loose" or "non-tight" list),
            pressing Enter to add a new item will insert an extra blank line to match the existing
            style. This is the default behavior of the CodeMirror markdown editor — it preserves
            the spacing pattern of the list.
          </p>
          <p>
            For example, if you have:
          </p>
          <pre className="bg-gray-50 border border-gray-200 rounded p-3 text-xs font-mono whitespace-pre overflow-x-auto">
{`- [ ] First item
                         ← blank line
- [ ] Second item`}
          </pre>
          <p>
            Pressing Enter after "First item" will add a new checkbox with a blank line above it,
            matching the loose list style. To avoid this, keep list items on consecutive lines without
            blank lines between them.
          </p>
        </KnownIssue>

        <KnownIssue title="Shift+Arrow selection gets stuck on wrapped lines" status="bug">
          <p>
            When word wrap is enabled and a line wraps to multiple visual lines, using Shift+Down or
            Shift+Up to extend the selection can get stuck at the visual line boundary. Regular arrow
            keys (without Shift) are not affected.
          </p>
          <p>
            <strong>Workaround:</strong> Press Shift+Right to advance past the stuck point, then
            continue with Shift+Down. Alternatively, toggle word wrap off (Alt+Z) to avoid the issue.
          </p>
        </KnownIssue>

        <KnownIssue title="Toolbar flickers when interacting with Find &amp; Replace checkboxes" status="bug">
          <p>
            Clicking the checkboxes (e.g., &quot;match case&quot;, &quot;regexp&quot;) in the editor&apos;s
            Find &amp; Replace panel can cause the formatting toolbar to briefly appear and disappear.
          </p>
        </KnownIssue>
      </DocsSection>
    </div>
  )
}
