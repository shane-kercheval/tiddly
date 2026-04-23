import { Link, useParams } from 'react-router-dom'
import { useRun } from '../hooks/useRuns'
import SummaryMatrix from './SummaryMatrix'
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
            <h2 className="text-base font-semibold text-gray-900">{metadata.eval_name || config.test_function}</h2>
            {metadata.eval_description && (
              <p className="text-sm text-gray-500 mt-1 whitespace-pre-line">{metadata.eval_description.trim()}</p>
            )}
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
            <p className="font-medium text-gray-900">{metadata.model_name ?? (run.results[0]?.execution_context?.output?.value as Record<string, unknown>)?.model_name as string ?? 'unknown'}</p>
          </div>
          {metadata.temperature != null && (
            <div>
              <span className="text-xs text-gray-400">Temperature</span>
              <p className="font-medium text-gray-900 tabular-nums">{metadata.temperature}</p>
            </div>
          )}
          <div>
            <span className="text-xs text-gray-400">Pass Mode</span>
            <p className="font-medium text-gray-900">{results.pass_mode === 'per_test_case' ? 'Per Test Case' : 'Sample'}</p>
          </div>
          {results.pass_mode === 'per_test_case' && results.per_test_case ? (
            <div>
              <span className="text-xs text-gray-400">Test Cases</span>
              <p className="font-medium text-gray-900 tabular-nums">
                {results.per_test_case.filter(tc => tc.rate >= results.pass_threshold).length} / {results.per_test_case.length} passing
              </p>
            </div>
          ) : (
            <div>
              <span className="text-xs text-gray-400">Samples</span>
              <p className="font-medium text-gray-900 tabular-nums">
                {results.passed_samples} / {results.total_samples} passing
              </p>
            </div>
          )}
          <div>
            <span className="text-xs text-gray-400">Threshold</span>
            <p className="font-medium text-gray-900 tabular-nums">{(results.pass_threshold * 100).toFixed(0)}%</p>
          </div>
          <div>
            <span className="text-xs text-gray-400">Samples per Test Case</span>
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
          <div>
            <span className="text-xs text-gray-400">Test Function</span>
            <p className="font-medium text-gray-900 font-mono text-xs">{config.test_function}</p>
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

      <SummaryMatrix results={run.results} passThreshold={results.pass_threshold} />
      <TestCaseTable results={run.results} passThreshold={results.pass_threshold} />

      <details className="mt-4">
        <summary className="text-xs text-gray-400 cursor-pointer hover:text-gray-600">
          How to interpret these results
        </summary>
        <div className="mt-2 bg-gray-50 rounded-lg border border-gray-200 p-4 text-xs text-gray-600 space-y-2">
          <p>
            <strong>Pass Mode</strong> determines how pass/fail is decided:
          </p>
          <ul className="list-disc ml-4 space-y-1">
            <li>
              <strong>Per Test Case</strong> — Each test case is evaluated independently across all samples.
              A test case passes if it succeeds in at least <em>threshold</em>% of samples.
              The overall eval passes if all test cases individually meet the threshold.
            </li>
            <li>
              <strong>Sample</strong> — A sample passes if all test cases pass within that sample.
              The overall eval passes if at least <em>threshold</em>% of samples pass.
            </li>
          </ul>
          <p>
            <strong>Samples</strong> are independent runs of the same test cases. Multiple samples capture variance from non-deterministic LLM outputs (e.g., temperature {'>'} 0).
          </p>
          <p>
            <strong>Checks</strong> are individual assertions on each test case output. A sample passes for a test case only if all checks pass.
            Deterministic checks (subset, disjoint, threshold) verify structural correctness.
            LLM judge checks verify semantic quality.
          </p>
          <p>
            <strong>Summary matrix colors</strong>: <span className="text-emerald-700">Green</span> = 100% pass rate.{' '}
            <span className="text-amber-700">Amber</span> = above threshold but not 100%.{' '}
            <span className="text-red-700">Red</span> = below threshold.
          </p>
        </div>
      </details>
    </div>
  )
}
