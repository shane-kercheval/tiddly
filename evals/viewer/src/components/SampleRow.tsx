import { useState } from 'react'
import type { SampleResult } from '../types'
import CheckBadge from './CheckBadge'

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

export default function SampleRow({ sample, index }: SampleRowProps) {
  const [expanded, setExpanded] = useState(false)
  const passed = samplePassed(sample)
  const duration = sample.execution_context.output.metadata.duration_seconds
  const value = sample.execution_context.output.value as Record<string, string | object | null>
  const usage = value.usage as { total_cost?: number; input_tokens?: number; output_tokens?: number } | undefined

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
        <span className="flex gap-1 ml-auto">
          {sample.check_results.map((check, i) => (
            <CheckBadge key={i} check={check} />
          ))}
        </span>
        <span className="text-gray-300 text-xs">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {value.tool_prediction && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Tool Prediction</h5>
              <pre className="text-xs bg-gray-50 p-2.5 rounded overflow-x-auto">
                {JSON.stringify(value.tool_prediction, null, 2)}
              </pre>
            </div>
          )}
          {value.final_content && (
            <div>
              <h5 className="text-xs font-medium text-gray-400 mb-1">Final Content</h5>
              <pre className="text-xs bg-gray-50 p-2.5 rounded overflow-x-auto whitespace-pre-wrap">
                {String(value.final_content)}
              </pre>
            </div>
          )}
          {(value.prompt || value.llm_prompt) && (
            <details>
              <summary className="text-xs font-medium text-gray-400 cursor-pointer">LLM Prompt</summary>
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
