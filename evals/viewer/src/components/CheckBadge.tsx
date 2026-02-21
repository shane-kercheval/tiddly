import type { CheckResult } from '../types'

interface CheckBadgeProps {
  check: CheckResult
}

export default function CheckBadge({ check }: CheckBadgeProps) {
  const passed = check.status === 'completed' && check.results.passed
  const isError = check.status === 'error'

  const color = isError
    ? 'bg-yellow-100 text-yellow-800'
    : passed
      ? 'bg-green-100 text-green-800'
      : 'bg-red-100 text-red-800'

  const label = isError ? 'error' : passed ? 'pass' : 'fail'

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {check.check_type}: {label}
    </span>
  )
}
