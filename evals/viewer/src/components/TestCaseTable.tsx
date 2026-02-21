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

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-gray-700">
        Test Cases ({groups.length})
      </h3>
      {groups.map((group) => (
        <TestCaseRow key={group.id} group={group} />
      ))}
    </div>
  )
}

function TestCaseRow({ group }: { group: GroupedTestCase }) {
  const [expanded, setExpanded] = useState(false)
  const passedCount = group.samples.filter(samplePassed).length
  const total = group.samples.length
  const allPassed = passedCount === total
  const avgDuration =
    group.samples.reduce((sum, s) => sum + s.execution_context.output.metadata.duration_seconds, 0) /
    total

  return (
    <div className="bg-white rounded border border-gray-200">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-3 text-sm hover:bg-gray-50 text-left"
      >
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          allPassed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {passedCount}/{total}
        </span>
        <span className="font-medium text-gray-900">{group.id}</span>
        <span className="text-gray-500 truncate flex-1">{group.description}</span>
        <span className="text-gray-400 text-xs">{avgDuration.toFixed(2)}s avg</span>
        <span className="text-gray-400">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div>
          {group.samples.map((sample, i) => (
            <SampleRow key={i} sample={sample} index={i} />
          ))}
        </div>
      )}
    </div>
  )
}
