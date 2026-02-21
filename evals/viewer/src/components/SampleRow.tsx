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

  return (
    <div className="border-t border-gray-100">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-3 px-4 py-2 text-sm hover:bg-gray-50 text-left"
      >
        <span className="text-gray-400 w-8">#{index + 1}</span>
        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
          passed ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {passed ? 'pass' : 'fail'}
        </span>
        <span className="text-gray-500">{duration.toFixed(2)}s</span>
        <span className="flex gap-1 ml-auto">
          {sample.check_results.map((check, i) => (
            <CheckBadge key={i} check={check} />
          ))}
        </span>
        <span className="text-gray-400">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {value.tool_prediction && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 mb-1">Tool Prediction</h5>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto">
                {JSON.stringify(value.tool_prediction, null, 2)}
              </pre>
            </div>
          )}
          {value.final_content && (
            <div>
              <h5 className="text-xs font-medium text-gray-500 mb-1">Final Content</h5>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap">
                {String(value.final_content)}
              </pre>
            </div>
          )}
          {(value.prompt || value.llm_prompt) && (
            <details>
              <summary className="text-xs font-medium text-gray-500 cursor-pointer">LLM Prompt</summary>
              <pre className="text-xs bg-gray-50 p-3 rounded overflow-x-auto whitespace-pre-wrap mt-1">
                {String(value.prompt || value.llm_prompt)}
              </pre>
            </details>
          )}
          {value.edit_error && (
            <div>
              <h5 className="text-xs font-medium text-red-600 mb-1">Error</h5>
              <pre className="text-xs bg-red-50 p-3 rounded overflow-x-auto">
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
