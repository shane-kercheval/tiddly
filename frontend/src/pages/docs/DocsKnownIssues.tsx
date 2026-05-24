/**
 * Known Issues docs page.
 *
 * Documents known behaviors, limitations, and planned improvements.
 * Each issue is classified by type to set expectations.
 */
import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { DocsSection } from './components/DocsSection'
import { DocsMarkdown } from '../../components/markdown/DocsMarkdown'
import { KNOWN_ISSUES_SECTIONS, type IssueStatus } from '../../content/data/knownIssues'

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

      {KNOWN_ISSUES_SECTIONS.map((section) => (
        <DocsSection key={section.section} title={section.section}>
          {section.items.map((item) => (
            <div key={item.title} className="border-b border-gray-100 py-5 last:border-b-0">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="text-base font-medium text-gray-900">{item.title}</h3>
                <StatusBadge status={item.status} />
              </div>
              <div className="text-sm text-gray-600 space-y-2">
                <DocsMarkdown body={item.body} />
              </div>
            </div>
          ))}
        </DocsSection>
      ))}
    </div>
  )
}
