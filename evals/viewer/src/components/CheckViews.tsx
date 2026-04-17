import type { CheckResult } from '../types'
import SyntaxJson from './SyntaxJson'

function resolvedValue(arg: unknown): unknown {
  if (arg && typeof arg === 'object' && 'value' in arg) return (arg as Record<string, unknown>).value
  return arg
}

function resolvedJsonpath(arg: unknown): string | undefined {
  if (arg && typeof arg === 'object' && 'jsonpath' in arg) return (arg as Record<string, string>).jsonpath
  return undefined
}

interface Flag {
  label: string
  isDefault: boolean
}

function Flags({ items }: { items: Flag[] }) {
  if (items.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((flag) => (
        <span
          key={flag.label}
          className={`text-[11px] px-1.5 py-0.5 rounded font-mono ${
            flag.isDefault
              ? 'bg-gray-100 text-gray-500'
              : 'bg-amber-100 text-amber-800'
          }`}
        >
          {flag.label}
        </span>
      ))}
    </div>
  )
}

function formatValue(val: unknown): string {
  if (val === null || val === undefined) return String(val)
  if (typeof val === 'object') return JSON.stringify(val, null, 2)
  return String(val)
}

function FieldLabel({ label, jsonpath }: { label: string; jsonpath?: string }) {
  return (
    <h6 className="text-[11px] text-gray-400 mb-0.5">
      {label}
      {jsonpath && <span className="font-mono text-gray-300 ml-1.5">{jsonpath}</span>}
    </h6>
  )
}

function ValueCell({ label, value, jsonpath }: { label: string; value: unknown; jsonpath?: string }) {
  return (
    <div className="flex-1 min-w-0">
      <FieldLabel label={label} jsonpath={jsonpath} />
      <SyntaxJson data={value} className="p-2 break-all" />
    </div>
  )
}

function ExactMatchView({ check }: { check: CheckResult }) {
  const args = check.resolved_arguments
  const actual = resolvedValue(args.actual)
  const expected = resolvedValue(args.expected)
  const caseSensitive = resolvedValue(args.case_sensitive)
  const negate = resolvedValue(args.negate)
  const flags: Flag[] = []
  if (caseSensitive !== undefined) flags.push({ label: `case_sensitive=${caseSensitive}`, isDefault: caseSensitive === true })
  if (negate !== undefined) flags.push({ label: `negate=${negate}`, isDefault: negate === false })

  return (
    <div className="space-y-2">
      <Flags items={flags} />
      <div className="flex gap-3">
        <ValueCell label="Expected" value={expected} jsonpath={resolvedJsonpath(args.expected)} />
        <ValueCell label="Actual" value={actual} jsonpath={resolvedJsonpath(args.actual)} />
      </div>
    </div>
  )
}

function ContainsView({ check }: { check: CheckResult }) {
  const args = check.resolved_arguments
  const phrases = resolvedValue(args.phrases)
  const found = check.results.found
  const negate = resolvedValue(args.negate)
  const matchAll = resolvedValue(args.match_all)
  const caseSensitive = resolvedValue(args.case_sensitive)
  const flags: Flag[] = []
  if (caseSensitive !== undefined) flags.push({ label: `case_sensitive=${caseSensitive}`, isDefault: caseSensitive === true })
  if (matchAll !== undefined) flags.push({ label: `match_all=${matchAll}`, isDefault: matchAll === true })
  if (negate !== undefined) flags.push({ label: `negate=${negate}`, isDefault: negate === false })

  const text = resolvedValue(args.text)

  return (
    <div className="space-y-2">
      <Flags items={flags} />
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <FieldLabel label="Phrases Searched" jsonpath={resolvedJsonpath(args.phrases)} />
          <SyntaxJson data={phrases} className="p-2 break-all" />
        </div>
        {found != null && (
          <div className="flex-1 min-w-0">
            <FieldLabel label="Phrases Found" />
            <SyntaxJson data={found} className="p-2 break-all" />
          </div>
        )}
      </div>
      {text != null && (
        <div>
          <FieldLabel label="Text Searched" jsonpath={resolvedJsonpath(args.text)} />
          <SyntaxJson data={text} className="p-2 break-all max-h-60 overflow-y-auto" />
        </div>
      )}
    </div>
  )
}

function EqualsView({ check }: { check: CheckResult }) {
  const args = check.resolved_arguments
  const actual = resolvedValue(args.actual)
  const expected = resolvedValue(args.expected)
  const negate = resolvedValue(args.negate)
  const flags: Flag[] = []
  if (negate !== undefined) flags.push({ label: `negate=${negate}`, isDefault: negate === false })

  return (
    <div className="space-y-2">
      <Flags items={flags} />
      <div className="flex gap-3">
        <ValueCell label="Expected" value={expected} jsonpath={resolvedJsonpath(args.expected)} />
        <ValueCell label="Actual" value={actual} jsonpath={resolvedJsonpath(args.actual)} />
      </div>
    </div>
  )
}

function LLMJudgeView({ check }: { check: CheckResult }) {
  const results = check.results
  const args = check.resolved_arguments
  const prompt = resolvedValue(args?.prompt)

  // Separate reasoning (display as text) from metrics (display as key-value)
  const { passed: _passed, judge_metadata: _meta, reasoning, ...metrics } = results
  const reasoningStr = reasoning != null ? String(reasoning) : null

  return (
    <div className="space-y-2">
      {reasoningStr && (
        <div>
          <FieldLabel label="Reasoning" />
          <p className="text-xs bg-gray-50 p-2 rounded text-gray-700 whitespace-pre-wrap">
            {reasoningStr}
          </p>
        </div>
      )}
      {Object.keys(metrics).length > 0 && (
        <div className="flex flex-wrap gap-3">
          {Object.entries(metrics).map(([key, val]) => (
            <div key={key} className="text-xs">
              <span className="text-gray-400">{key.replace(/_/g, ' ')}: </span>
              <span className="font-medium text-gray-700">{String(val)}</span>
            </div>
          ))}
        </div>
      )}
      {prompt != null && (
        <details>
          <summary className="text-[11px] text-gray-400 cursor-pointer">
            Judge Prompt
          </summary>
          <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all text-blue-700 max-h-60 overflow-y-auto mt-1">
            {formatValue(prompt)}
          </pre>
        </details>
      )}
    </div>
  )
}

function ResultsView({ check }: { check: CheckResult }) {
  const results = check.results
  const { passed: _passed, ...otherResults } = results
  const args = check.resolved_arguments

  // Show the resolved value if results only has 'passed' (e.g. is_empty, threshold)
  const resolvedVal = args ? resolvedValue(args.value ?? args.collection) : undefined

  return (
    <div className="space-y-2">
      {Object.keys(otherResults).length > 0 && (
        <div>
          <FieldLabel label="Results" />
          <SyntaxJson data={otherResults} className="p-2 break-all" />
        </div>
      )}
      {Object.keys(otherResults).length === 0 && resolvedVal != null && (
        <div>
          <FieldLabel label="Resolved Value" jsonpath={resolvedJsonpath(args?.value ?? args?.collection)} />
          <SyntaxJson data={resolvedVal} className="p-2 break-all" />
        </div>
      )}
    </div>
  )
}

function FallbackView({ check }: { check: CheckResult }) {
  const results = check.results
  const { passed: _passed, ...otherResults } = results

  return (
    <div className="space-y-2">
      {Object.keys(otherResults).length > 0 && (
        <div>
          <FieldLabel label="Results" />
          <SyntaxJson data={otherResults} className="p-2 break-all" />
        </div>
      )}
      <div>
        <h6 className="text-[11px] text-gray-400 mb-0.5">Resolved Arguments</h6>
        <SyntaxJson data={check.resolved_arguments} className="p-2" />
      </div>
    </div>
  )
}

export default function CheckBody({ check }: { check: CheckResult }) {
  switch (check.check_type) {
    case 'exact_match':
      return <ExactMatchView check={check} />
    case 'contains':
      return <ContainsView check={check} />
    case 'equals':
      return <EqualsView check={check} />
    case 'llm_judge':
      return <LLMJudgeView check={check} />
    case 'subset':
    case 'superset':
    case 'disjoint':
    case 'set_equal':
    case 'is_empty':
    case 'threshold':
      return <ResultsView check={check} />
    default:
      return <FallbackView check={check} />
  }
}
