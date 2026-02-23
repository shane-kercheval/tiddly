import type { SampleResult } from '../types'
import { samplePassed } from './SampleRow'

interface SummaryMatrixProps {
  results: SampleResult[]
}

interface CellData {
  passed: number
  total: number
}

function cellBg(cell: CellData): string {
  if (cell.total === 0) return ''
  const rate = cell.passed / cell.total
  if (rate >= 1) return 'bg-emerald-50 text-emerald-700'
  if (rate > 0.5) return 'bg-amber-50 text-amber-700'
  return 'bg-red-50 text-red-700'
}

export default function SummaryMatrix({ results }: SummaryMatrixProps) {
  // Discover unique check names in stable order
  const checkNames: string[] = []
  const checkNameSet = new Set<string>()
  for (const r of results) {
    for (const c of r.check_results) {
      const name = c.metadata?.name || c.check_type
      if (!checkNameSet.has(name)) {
        checkNameSet.add(name)
        checkNames.push(name)
      }
    }
  }

  // Group results by test case ID
  const groupOrder: string[] = []
  const groups = new Map<string, SampleResult[]>()
  for (const r of results) {
    const id = r.execution_context.test_case.id
    const existing = groups.get(id)
    if (existing) {
      existing.push(r)
    } else {
      groupOrder.push(id)
      groups.set(id, [r])
    }
  }

  // Build matrix: testCaseId -> checkName -> CellData
  const matrix = new Map<string, Map<string, CellData>>()
  const overallMap = new Map<string, CellData>()

  for (const [tcId, samples] of groups) {
    const row = new Map<string, CellData>()
    for (const name of checkNames) {
      row.set(name, { passed: 0, total: 0 })
    }
    matrix.set(tcId, row)

    let overallPassed = 0
    for (const sample of samples) {
      if (samplePassed(sample)) overallPassed++
      for (const c of sample.check_results) {
        const name = c.metadata?.name || c.check_type
        const cell = row.get(name)
        if (cell) {
          cell.total++
          if (c.status === 'completed' && c.results.passed) cell.passed++
        }
      }
    }
    overallMap.set(tcId, { passed: overallPassed, total: samples.length })
  }

  if (checkNames.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-4 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left text-xs font-medium text-gray-400 uppercase tracking-wider px-3 py-2 sticky left-0 bg-white">
              Test Case
            </th>
            {checkNames.map((name) => (
              <th key={name} className="text-center text-xs font-medium text-gray-400 uppercase tracking-wider px-3 py-2 whitespace-nowrap">
                {name}
              </th>
            ))}
            <th className="text-center text-xs font-medium text-gray-400 uppercase tracking-wider px-3 py-2">
              Overall
            </th>
          </tr>
        </thead>
        <tbody>
          {groupOrder.map((tcId) => {
            const row = matrix.get(tcId)!
            const overall = overallMap.get(tcId)!
            return (
              <tr key={tcId} className="border-b border-gray-100 last:border-b-0">
                <td className="px-3 py-1.5 font-medium text-gray-900 text-xs sticky left-0 bg-white truncate max-w-[200px]" title={tcId}>
                  {tcId}
                </td>
                {checkNames.map((name) => {
                  const cell = row.get(name)!
                  return (
                    <td key={name} className={`px-3 py-1.5 text-center text-xs font-medium tabular-nums ${cellBg(cell)}`}>
                      {cell.total > 0 ? `${cell.passed}/${cell.total}` : '-'}
                    </td>
                  )
                })}
                <td className={`px-3 py-1.5 text-center text-xs font-medium tabular-nums ${cellBg(overall)}`}>
                  {overall.passed}/{overall.total}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
