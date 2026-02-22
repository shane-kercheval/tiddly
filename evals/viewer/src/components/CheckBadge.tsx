import type { CheckResult } from '../types'

interface CheckBadgeProps {
  check: CheckResult
}

export default function CheckBadge({ check }: CheckBadgeProps) {
  const passed = check.status === 'completed' && check.results.passed
  const isError = check.status === 'error'

  const color = isError
    ? 'bg-yellow-50 text-yellow-700'
    : passed
      ? 'bg-emerald-50 text-emerald-700'
      : 'bg-red-50 text-red-700'

  const label = isError ? 'error' : passed ? 'pass' : 'fail'

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium ${color}`}>
      {check.check_type}: {label}
    </span>
  )
}
