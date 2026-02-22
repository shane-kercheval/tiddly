import { useState } from 'react'
import type { SampleResult } from '../types'
import SampleRow, { samplePassed } from './SampleRow'

interface TestCaseTableProps {
  results: SampleResult[]
}

interface GroupedTestCase {
  id: string
  description: string
  samples: SampleResult[]
}

function groupByTestCase(results: SampleResult[]): GroupedTestCase[] {
  const groups = new Map<string, GroupedTestCase>()
  for (const result of results) {
    const tc = result.execution_context.test_case
    const existing = groups.get(tc.id)
    if (existing) {
      existing.samples.push(result)
    } else {
      groups.set(tc.id, {
        id: tc.id,
        description: tc.metadata.description,
        samples: [result],
      })
    }
  }
  return Array.from(groups.values())
}

export default function TestCaseTable({ results }: TestCaseTableProps) {
  const groups = groupByTestCase(results)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const allExpanded = expandedGroups.size === groups.length

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-xs font-medium text-gray-400 uppercase tracking-wider">
          Test Cases ({groups.length})
        </h3>
        <button
          onClick={() => {
            if (allExpanded) {
              setExpandedGroups(new Set())
            } else {
              setExpandedGroups(new Set(groups.map((g) => g.id)))
            }
          }}
          className="text-gray-400 hover:text-gray-600 transition-colors text-sm font-mono leading-none"
          title={allExpanded ? 'Collapse all test cases' : 'Expand all test cases'}
        >
          {allExpanded ? '\u2212' : '+'}
        </button>
      </div>
      {groups.map((group) => (
        <TestCaseRow
          key={group.id}
          group={group}
          expanded={expandedGroups.has(group.id)}
          onToggle={() => {
            setExpandedGroups((prev) => {
              const next = new Set(prev)
              if (next.has(group.id)) next.delete(group.id)
              else next.add(group.id)
              return next
            })
          }}
        />
      ))}
    </div>
  )
}

function TestCaseRow({ group, expanded, onToggle }: { group: GroupedTestCase; expanded: boolean; onToggle: () => void }) {
  const passedCount = group.samples.filter(samplePassed).length
  const total = group.samples.length
  const allPassed = passedCount === total
  const avgDuration =
    group.samples.reduce((sum, s) => sum + s.execution_context.output.metadata.duration_seconds, 0) /
    total
  const costs = group.samples
    .map((s) => (s.execution_context.output.value as Record<string, unknown>)?.usage as { total_cost?: number } | undefined)
    .filter((u): u is { total_cost: number } => u?.total_cost != null)
  const avgCost = costs.length > 0
    ? costs.reduce((sum, u) => sum + u.total_cost, 0) / costs.length
    : null

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-blue-50 text-left transition-colors"
      >
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium tabular-nums ${
          allPassed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {passedCount}/{total}
        </span>
        <span className="font-medium text-gray-900">{group.id}</span>
        <span className="text-gray-500 truncate flex-1">{group.description}</span>
        <span className="text-gray-400 text-xs tabular-nums">{avgDuration.toFixed(2)}s avg</span>
        {avgCost != null && (
          <span className="text-gray-400 text-xs tabular-nums">${avgCost.toFixed(4)} avg</span>
        )}
        <span className="text-gray-300 text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      <div className={expanded ? '' : 'hidden'}>
        {group.samples.map((sample, i) => (
          <SampleRow key={i} sample={sample} index={i} />
        ))}
      </div>
    </div>
  )
}
