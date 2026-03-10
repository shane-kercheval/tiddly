/**
 * Known Issues docs page.
 *
 * Documents known behaviors, limitations, and planned improvements.
 * Each issue is classified by type to set expectations.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { DocsSection } from './components/DocsSection'

type IssueStatus = 'expected-behavior' | 'limitation' | 'planned'

interface StatusBadgeProps {
  status: IssueStatus
}

const statusConfig: Record<IssueStatus, { label: string; className: string }> = {
  'expected-behavior': {
    label: 'Expected Behavior',
    className: 'bg-blue-50 text-blue-700 border-blue-200',
  },
  'limitation': {
    label: 'Current Limitation',
    className: 'bg-amber-50 text-amber-700 border-amber-200',
  },
  'planned': {
    label: 'Planned Improvement',
    className: 'bg-green-50 text-green-700 border-green-200',
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
        Documented behaviors, limitations, and planned improvements. Each item is classified to set expectations:
      </p>
      <div className="flex flex-wrap gap-3 mb-8 text-sm text-gray-600">
        <span className="flex items-center gap-1.5"><StatusBadge status="expected-behavior" /> Working as designed, not a bug</span>
        <span className="flex items-center gap-1.5"><StatusBadge status="limitation" /> Known constraint we plan to address</span>
        <span className="flex items-center gap-1.5"><StatusBadge status="planned" /> Improvement already in progress</span>
      </div>

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
      </DocsSection>
    </div>
  )
}
