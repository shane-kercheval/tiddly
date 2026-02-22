import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRuns } from '../hooks/useRuns'
import Filters, { type FilterValues } from './Filters'

export default function RunsList() {
  const { runs, loading, error } = useRuns()
  const [filters, setFilters] = useState<FilterValues>({
    testFunction: '',
    status: '',
    model: '',
  })

  const testFunctions = useMemo(
    () => [...new Set(runs.map((r) => r.metadata._test_config.test_function))],
    [runs],
  )
  const models = useMemo(
    () => [...new Set(runs.map((r) => r.metadata.model_name))],
    [runs],
  )

  const filtered = useMemo(() => {
    return runs.filter((r) => {
      if (filters.testFunction && r.metadata._test_config.test_function !== filters.testFunction) return false
      if (filters.status === 'passed' && !r.metadata._test_results.passed) return false
      if (filters.status === 'failed' && r.metadata._test_results.passed) return false
      if (filters.model && r.metadata.model_name !== filters.model) return false
      return true
    })
  }, [runs, filters])

  const navigate = useNavigate()

  if (loading) return <p className="text-gray-500">Loading...</p>
  if (error) return <p className="text-red-600">Error: {error}</p>

  return (
    <div>
      <Filters
        filters={filters}
        onFiltersChange={setFilters}
        testFunctions={testFunctions}
        models={models}
      />

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-sm">
        <table className="min-w-full">
          <thead>
            <tr className="border-b border-gray-200">
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Time</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Test Function</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Model</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Rate</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Status</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Samples</th>
              <th className="px-3 py-2 text-left text-[11px] font-medium text-gray-400 uppercase tracking-wider">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((run) => {
              const config = run.metadata._test_config
              const results = run.metadata._test_results
              return (
                <tr
                  key={run.evaluation_id}
                  onClick={() => navigate(`/runs/${run.evaluation_id}`)}
                  className="hover:bg-blue-50/50 cursor-pointer transition-colors"
                >
                  <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap tabular-nums">
                    {new Date(run.started_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs font-medium text-gray-900">{config.test_function}</td>
                  <td className="px-3 py-2 text-xs text-gray-600">{run.metadata.model_name}</td>
                  <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">{(results.success_rate * 100).toFixed(0)}%</td>
                  <td className="px-3 py-2">
                    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${
                      results.passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>
                      {results.passed ? 'pass' : 'fail'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-600 tabular-nums">
                    {results.passed_samples}/{results.total_samples}
                  </td>
                  <td className="px-3 py-2 text-xs text-gray-400">{run.source_dir}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-6 text-xs text-gray-400">No runs found</p>
        )}
      </div>
    </div>
  )
}
