import type { ReactNode } from 'react'

interface StepSectionProps {
  step: number
  title: string
  children: ReactNode
}

/**
 * Numbered step with heading and content for setup instructions.
 */
export function StepSection({ step, title, children }: StepSectionProps): ReactNode {
  return (
    <div className="mb-8">
      <h3 className="text-base font-semibold text-gray-900 mb-2">
        Step {step}: {title}
      </h3>
      {children}
    </div>
  )
}
