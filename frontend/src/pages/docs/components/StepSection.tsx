import type { ReactNode } from 'react'

interface StepSectionProps {
  step: number
  title: string
  children: ReactNode
}

/**
 * Numbered step card for setup instructions.
 * Matches the StepCard visual from AISetupWidget.
 */
export function StepSection({ step, title, children }: StepSectionProps): ReactNode {
  return (
    <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex gap-4">
        <span className="text-lg font-semibold text-[#d97b3d] select-none">{step}</span>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
          {children}
        </div>
      </div>
    </div>
  )
}
