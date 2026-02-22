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

  // Compute cost/token totals from all samples
  const usageTotals = run.results.reduce(
    (acc, r) => {
      const usage = (r.execution_context.output.value as Record<string, unknown>)?.usage as
        { input_tokens?: number; output_tokens?: number; total_cost?: number } | undefined
      if (usage) {
        acc.inputTokens += usage.input_tokens ?? 0
        acc.outputTokens += usage.output_tokens ?? 0
        acc.totalCost += usage.total_cost ?? 0
      }
      return acc
    },
    { inputTokens: 0, outputTokens: 0, totalCost: 0 },
  )

  return (
    <div>
      <Link to="/" className="text-sm text-blue-600 hover:underline mb-3 inline-block">
        &larr; Back to runs
      </Link>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-4 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{config.test_function}</h2>
            <p className="text-xs text-gray-400 font-mono mt-0.5">{run.evaluation_id}</p>
          </div>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
          }`}>
            {passed ? 'PASSED' : 'FAILED'}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-2 text-sm">
          <div>
            <span className="text-xs text-gray-400">Model</span>
            <p className="font-medium text-gray-900">{metadata.model_name}</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Success Rate</span>
            <p className="font-medium text-gray-900 tabular-nums">{(results.success_rate * 100).toFixed(1)}%</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Threshold</span>
            <p className="font-medium text-gray-900 tabular-nums">{(results.success_threshold * 100).toFixed(0)}%</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Samples</span>
            <p className="font-medium text-gray-900 tabular-nums">
              {results.passed_samples} passed / {results.total_samples} total
            </p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Test Cases</span>
            <p className="font-medium text-gray-900 tabular-nums">{config.num_test_cases}</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Samples/Case</span>
            <p className="font-medium text-gray-900 tabular-nums">{config.samples}</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Started</span>
            <p className="font-medium text-gray-900">{new Date(run.started_at).toLocaleString()}</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Completed</span>
            <p className="font-medium text-gray-900">{new Date(run.completed_at).toLocaleString()}</p>
          </div>
          {usageTotals.totalCost > 0 && (
            <>
              <div>
                <span className="text-xs text-gray-400">Total Cost</span>
                <p className="font-medium text-gray-900 tabular-nums">${usageTotals.totalCost.toFixed(4)}</p>
              </div>
              <div>
                <span className="text-xs text-gray-400">Tokens</span>
                <p className="font-medium text-gray-900 tabular-nums">
                  {usageTotals.inputTokens.toLocaleString()} in / {usageTotals.outputTokens.toLocaleString()} out
                </p>
              </div>
            </>
          )}
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
