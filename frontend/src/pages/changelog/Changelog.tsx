import type { ReactNode } from 'react'
import { usePageTitle } from '../../hooks/usePageTitle'
import { CHANGELOG, type ChangelogTag, type ChangelogMonth } from '../../content/data/changelog'

const tagConfig: Record<ChangelogTag, { label: string; className: string }> = {
  web: { label: 'Web', className: 'bg-blue-50 text-blue-600 border-blue-200' },
  api: { label: 'API', className: 'bg-purple-50 text-purple-600 border-purple-200' },
  cli: { label: 'CLI', className: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
  extension: { label: 'Extension', className: 'bg-orange-50 text-orange-600 border-orange-200' },
  site: { label: 'Site', className: 'bg-cyan-50 text-cyan-600 border-cyan-200' },
  performance: { label: 'Performance', className: 'bg-amber-50 text-amber-600 border-amber-200' },
  ai: { label: 'AI', className: 'bg-pink-50 text-pink-600 border-pink-200' },
}

function TagBadge({ tag }: { tag: ChangelogTag }): ReactNode {
  const config = tagConfig[tag]
  return (
    <span className={`inline-block text-[10px] font-medium px-1.5 py-0 rounded-full border ${config.className}`}>
      {config.label}
    </span>
  )
}

function MonthSection({
  month,
  isFirst,
}: {
  month: ChangelogMonth
  isFirst: boolean
}): ReactNode {
  return (
    <section className={isFirst ? '' : 'mt-10 border-t border-gray-200 pt-10'}>
      <h2 className="text-2xl font-bold text-gray-900">{month.month}</h2>
      <p className="mt-1 text-sm italic text-gray-500">{month.theme}</p>

      {month.categories.map((category) => (
        <div key={category.label} className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-400">
            {category.emoji} {category.label}
          </h3>
          <ul className="mt-3 space-y-2">
            {category.entries.map((entry) => (
              <li key={entry.title} className="text-sm text-gray-600">
                <span className="font-semibold text-gray-900">{entry.title}</span>
                {entry.tag && <> <TagBadge tag={entry.tag} /></>}
                {' — '}
                {entry.description}
                {entry.pr && (
                  <>
                    {' '}
                    <a
                      href={`https://github.com/shane-kercheval/tiddly/pull/${entry.pr}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      #{entry.pr}
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

export function Changelog(): ReactNode {
  usePageTitle('Changelog')

  return (
    <div>
      <div className="pb-12 text-center">
        <h1 className="text-3xl font-bold text-gray-900">Changelog</h1>
        <p className="mt-3 text-gray-500">New features, improvements, and fixes.</p>
      </div>

      {CHANGELOG.map((month, i) => (
        <MonthSection key={month.month} month={month} isFirst={i === 0} />
      ))}
    </div>
  )
}
