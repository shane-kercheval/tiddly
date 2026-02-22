import { useState } from 'react'
import type { SampleResult, CheckResult } from '../types'
import CheckBody from './CheckViews'

interface SampleRowProps {
  sample: SampleResult
  index: number
}

function samplePassed(sample: SampleResult): boolean {
  return (
    sample.status === 'completed' &&
    sample.check_results.every((c) => c.status === 'completed' && c.results.passed)
  )
}

function checkPassed(check: CheckResult): boolean {
  return check.status === 'completed' && check.results.passed
}

function CheckDetail({ check, index }: { check: CheckResult; index: number }) {
  const passed = checkPassed(check)
  const isError = check.status === 'error'

  const statusBg = isError
    ? 'bg-yellow-50 text-yellow-700'
    : passed
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-700'

  const statusLabel = isError ? 'error' : passed ? 'pass' : 'fail'
  const label = check.metadata?.name || check.check_type

  return (
    <details className="group">
      <summary className="flex items-center gap-2 py-1.5 px-2 text-xs cursor-pointer hover:bg-gray-50 rounded transition-colors">
        <span className="text-gray-400 tabular-nums w-4">#{index + 1}</span>
        <span className="font-medium text-gray-700">{label}</span>
        {check.metadata?.name && (
          <span className="text-gray-400">{check.check_type}</span>
        )}
        <span className={`inline-flex items-center px-1 py-0.5 rounded text-[10px] font-medium ${statusBg}`}>{statusLabel}</span>
      </summary>
      <div className="ml-6 mb-2">
        {check.metadata?.description && (
          <p className="text-xs text-gray-500 mt-1 mb-1">{check.metadata.description}</p>
        )}
        {check.resolved_arguments && Object.keys(check.resolved_arguments).length > 0 && (
          <div className="mt-1">
            <CheckBody check={check} />
          </div>
        )}
        {check.error != null && (
          <div className="mt-1">
            <h6 className="text-[11px] text-red-400 mb-0.5">Error</h6>
            <pre className="text-xs bg-red-50 p-2 rounded overflow-x-auto whitespace-pre-wrap">
              {String(check.error)}
            </pre>
          </div>
        )}
      </div>
    </details>
  )
}

export default function SampleRow({ sample, index }: SampleRowProps) {
  const [expanded, setExpanded] = useState(false)
  const passed = samplePassed(sample)
  const duration = sample.execution_context.output.metadata.duration_seconds
  const value = sample.execution_context.output.value as Record<string, string | object | null>
  const usage = value.usage as { total_cost?: number; input_tokens?: number; output_tokens?: number } | undefined

  const passedChecks = sample.check_results.filter(checkPassed).length
  const totalChecks = sample.check_results.length
  const allChecksPassed = passedChecks === totalChecks

  const testCase = sample.execution_context.test_case

  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-3 py-2 text-sm hover:bg-blue-50 text-left transition-colors"
      >
        <span className="text-gray-400 text-xs w-6 tabular-nums">#{index + 1}</span>
        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${
          passed ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
        }`}>
          {passed ? 'pass' : 'fail'}
        </span>
        <span className="text-gray-500 text-xs tabular-nums">{duration.toFixed(2)}s</span>
        {usage?.total_cost != null && (
          <span className="text-gray-400 text-xs tabular-nums">${usage.total_cost.toFixed(4)}</span>
        )}
        <span className={`text-xs tabular-nums ml-auto ${allChecksPassed ? 'text-emerald-600' : 'text-red-600'}`}>
          {passedChecks}/{totalChecks} checks
        </span>
        <span className="text-gray-300 text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2 ml-3 border-l-2 border-blue-300">
          {sample.check_results.length > 0 && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Checks</h5>
              <div className="border border-gray-100 rounded divide-y divide-gray-100">
                {sample.check_results.map((check, i) => (
                  <CheckDetail key={i} check={check} index={i} />
                ))}
              </div>
            </div>
          )}
          {testCase && (
            <details>
              <summary className="text-xs font-medium text-gray-400 cursor-pointer">
                Test Case
                <span className="font-normal text-gray-300 ml-1.5">Input and expected values for this test case</span>
              </summary>
              <pre className="text-xs bg-gray-50 p-2.5 rounded overflow-x-auto whitespace-pre-wrap mt-1">
                {JSON.stringify({ id: testCase.id, input: testCase.input, expected: testCase.expected, metadata: testCase.metadata }, null, 2)}
              </pre>
            </details>
          )}
          {value.tool_predictions && (
            <details>
              <summary className="text-xs font-medium text-gray-400 cursor-pointer">
                Tool Predictions
                <span className="font-normal text-gray-300 ml-1.5">The tool call(s) the LLM chose to make</span>
              </summary>
              <pre className="text-xs bg-gray-50 p-2.5 rounded overflow-x-auto mt-1">
                {JSON.stringify(value.tool_predictions, null, 2)}
              </pre>
            </details>
          )}
          {value.final_content && (
            <details>
              <summary className="text-xs font-medium text-gray-400 cursor-pointer">
                Final Content
                <span className="font-normal text-gray-300 ml-1.5">Content after executing the predicted tool call</span>
              </summary>
              <pre className="text-xs bg-gray-50 p-2.5 rounded overflow-x-auto whitespace-pre-wrap mt-1">
                {String(value.final_content)}
              </pre>
            </details>
          )}
          {(value.prompt || value.llm_prompt) && (
            <details>
              <summary className="text-xs font-medium text-gray-400 cursor-pointer">
                LLM Prompt
                <span className="font-normal text-gray-300 ml-1.5">Full prompt sent to the LLM including MCP tool context</span>
              </summary>
              <pre className="text-xs bg-gray-50 p-2.5 rounded overflow-x-auto whitespace-pre-wrap mt-1">
                {String(value.prompt || value.llm_prompt)}
              </pre>
            </details>
          )}
          {value.edit_error && (
            <div>
              <h5 className="text-xs font-medium text-red-500 mb-1">Error</h5>
              <pre className="text-xs bg-red-50 p-2.5 rounded overflow-x-auto">
                {String(value.edit_error)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export { samplePassed }
