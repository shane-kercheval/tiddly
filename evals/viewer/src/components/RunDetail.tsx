import { Link, useParams } from 'react-router-dom'
import { useRun } from '../hooks/useRuns'
import AnnotationField from './AnnotationField'
import TestCaseTable from './TestCaseTable'

export default function RunDetail() {
  const { evaluationId } = useParams<{ evaluationId: string }>()
  const { run, loading, error } = useRun(evaluationId)

  if (loading) return <p className="text-gray-500">Loading...</p>
  if (error) return <p className="text-red-600">Error: {error}</p>
  if (!run) return <p className="text-gray-500">Run not found</p>

  const { metadata } = run
  const config = metadata._test_config
  const results = metadata._test_results
  const passed = results.passed

  return (
    <div>
      <Link to="/" className="text-sm text-blue-600 hover:underline mb-4 inline-block">
        &larr; Back to runs
      </Link>

      <div className="bg-white rounded border border-gray-200 p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">{config.test_function}</h2>
            <p className="text-sm text-gray-500 font-mono">{run.evaluation_id}</p>
          </div>
          <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${
            passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {passed ? 'PASSED' : 'FAILED'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Model</span>
            <p className="font-medium">{metadata.model_name}</p>
          </div>
          <div>
            <span className="text-gray-500">Success Rate</span>
            <p className="font-medium">{(results.success_rate * 100).toFixed(1)}%</p>
          </div>
          <div>
            <span className="text-gray-500">Threshold</span>
            <p className="font-medium">{(results.success_threshold * 100).toFixed(0)}%</p>
          </div>
          <div>
            <span className="text-gray-500">Samples</span>
            <p className="font-medium">
              {results.passed_samples} passed / {results.total_samples} total
            </p>
          </div>
          <div>
            <span className="text-gray-500">Test Cases</span>
            <p className="font-medium">{config.num_test_cases}</p>
          </div>
          <div>
            <span className="text-gray-500">Samples/Case</span>
            <p className="font-medium">{config.samples}</p>
          </div>
          <div>
            <span className="text-gray-500">Started</span>
            <p className="font-medium">{new Date(run.started_at).toLocaleString()}</p>
          </div>
          <div>
            <span className="text-gray-500">Completed</span>
            <p className="font-medium">{new Date(run.completed_at).toLocaleString()}</p>
          </div>
        </div>
      </div>

      <AnnotationField
        evaluationId={run.evaluation_id}
        initialValue={metadata.annotation ?? ''}
      />

      <TestCaseTable results={run.results} />
    </div>
  )
}
