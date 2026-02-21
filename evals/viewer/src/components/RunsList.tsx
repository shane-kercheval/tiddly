import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
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

      <div className="bg-white rounded border border-gray-200 overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Test Function</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Model</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Samples</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Source</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {filtered.map((run) => {
              const config = run.metadata._test_config
              const results = run.metadata._test_results
              return (
                <tr key={run.evaluation_id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">
                    <Link to={`/runs/${run.evaluation_id}`} className="hover:text-blue-600">
                      {new Date(run.started_at).toLocaleString()}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{config.test_function}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{run.metadata.model_name}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{(results.success_rate * 100).toFixed(0)}%</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      results.passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }`}>
                      {results.passed ? 'pass' : 'fail'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700">
                    {results.passed_samples}/{results.total_samples}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-500">{run.source_dir}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="text-center py-8 text-gray-500">No runs found</p>
        )}
      </div>
    </div>
  )
}
