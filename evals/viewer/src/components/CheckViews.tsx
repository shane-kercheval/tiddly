import type { CheckResult } from '../types'

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
    <div className="flex flex-wrap gap-1 mt-1">
      {items.map((flag) => (
        <span
          key={flag.label}
          className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
            flag.isDefault
              ? 'bg-gray-50 text-gray-400'
              : 'bg-amber-50 text-amber-700'
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

function ValueCell({ label, value, jsonpath, passed }: { label: string; value: unknown; jsonpath?: string; passed?: boolean }) {
  const color = passed === undefined ? 'text-gray-700' : passed ? 'text-emerald-700' : 'text-red-700'
  return (
    <div className="flex-1 min-w-0">
      <h6 className="text-[10px] text-gray-400 mb-0.5">{label}</h6>
      {jsonpath && <div className="text-[10px] text-gray-300 font-mono truncate mb-0.5">{jsonpath}</div>}
      <pre className={`text-xs bg-gray-50 p-1.5 rounded overflow-x-auto whitespace-pre-wrap break-all ${color}`}>
        {formatValue(value)}
      </pre>
    </div>
  )
}

function ExactMatchView({ check }: { check: CheckResult }) {
  const passed = check.results.passed
  const args = check.resolved_arguments
  const actual = resolvedValue(args.actual)
  const expected = resolvedValue(args.expected)
  const caseSensitive = resolvedValue(args.case_sensitive)
  const negate = resolvedValue(args.negate)
  const flags: Flag[] = []
  if (caseSensitive !== undefined) flags.push({ label: `case_sensitive=${caseSensitive}`, isDefault: caseSensitive === true })
  if (negate !== undefined) flags.push({ label: `negate=${negate}`, isDefault: negate === false })

  return (
    <div>
      <div className="flex gap-3">
        <ValueCell label="Actual" value={actual} jsonpath={resolvedJsonpath(args.actual)} passed={passed} />
        <ValueCell label="Expected" value={expected} jsonpath={resolvedJsonpath(args.expected)} />
      </div>
      <Flags items={flags} />
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
    <div>
      <div className="flex gap-3">
        <div className="flex-1 min-w-0">
          <h6 className="text-[10px] text-gray-400 mb-0.5">Phrases</h6>
          {resolvedJsonpath(args.phrases) && (
            <div className="text-[10px] text-gray-300 font-mono truncate mb-0.5">{resolvedJsonpath(args.phrases)}</div>
          )}
          <pre className="text-xs bg-gray-50 p-1.5 rounded overflow-x-auto whitespace-pre-wrap break-all text-gray-700">
            {formatValue(phrases)}
          </pre>
        </div>
        {found && (
          <div className="flex-1 min-w-0">
            <h6 className="text-[10px] text-gray-400 mb-0.5">Found</h6>
            <pre className={`text-xs bg-gray-50 p-1.5 rounded overflow-x-auto whitespace-pre-wrap break-all ${check.results.passed ? 'text-emerald-700' : 'text-red-700'}`}>
              {formatValue(found)}
            </pre>
          </div>
        )}
      </div>
      <Flags items={flags} />
      {text != null && (
        <details className="mt-1.5">
          <summary className="text-[10px] text-gray-400 cursor-pointer hover:text-gray-500">
            Search text
            {resolvedJsonpath(args.text) && (
              <span className="font-mono text-gray-300 ml-1">{resolvedJsonpath(args.text)}</span>
            )}
          </summary>
          <pre className="text-xs bg-gray-50 p-1.5 rounded overflow-x-auto whitespace-pre-wrap break-all mt-0.5 text-gray-600">
            {formatValue(text)}
          </pre>
        </details>
      )}
    </div>
  )
}

function EqualsView({ check }: { check: CheckResult }) {
  const passed = check.results.passed
  const args = check.resolved_arguments
  const actual = resolvedValue(args.actual)
  const expected = resolvedValue(args.expected)
  const negate = resolvedValue(args.negate)
  const flags: Flag[] = []
  if (negate !== undefined) flags.push({ label: `negate=${negate}`, isDefault: negate === false })

  return (
    <div>
      <div className="flex gap-3">
        <ValueCell label="Actual" value={actual} jsonpath={resolvedJsonpath(args.actual)} passed={passed} />
        <ValueCell label="Expected" value={expected} jsonpath={resolvedJsonpath(args.expected)} />
      </div>
      <Flags items={flags} />
    </div>
  )
}

function FallbackView({ check }: { check: CheckResult }) {
  return (
    <div>
      <h6 className="text-[11px] text-gray-400 mb-0.5">Resolved Arguments</h6>
      <pre className="text-xs bg-gray-50 p-2 rounded overflow-x-auto whitespace-pre-wrap">
        {JSON.stringify(check.resolved_arguments, null, 2)}
      </pre>
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
    default:
      return <FallbackView check={check} />
  }
}
