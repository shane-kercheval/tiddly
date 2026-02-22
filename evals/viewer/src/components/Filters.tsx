export interface FilterValues {
  testFunction: string
  status: string
  model: string
}

interface FiltersProps {
  filters: FilterValues
  onFiltersChange: (filters: FilterValues) => void
  testFunctions: string[]
  models: string[]
}

export default function Filters({ filters, onFiltersChange, testFunctions, models }: FiltersProps) {
  return (
    <div className="flex gap-2 mb-3">
      <select
        value={filters.testFunction}
        onChange={(e) => onFiltersChange({ ...filters, testFunction: e.target.value })}
        className="h-7 rounded border border-gray-300 px-2 text-xs bg-white text-gray-700"
      >
        <option value="">All test functions</option>
        {testFunctions.map((fn) => (
          <option key={fn} value={fn}>{fn}</option>
        ))}
      </select>
      <select
        value={filters.status}
        onChange={(e) => onFiltersChange({ ...filters, status: e.target.value })}
        className="h-7 rounded border border-gray-300 px-2 text-xs bg-white text-gray-700"
      >
        <option value="">All statuses</option>
        <option value="passed">Passed</option>
        <option value="failed">Failed</option>
      </select>
      <select
        value={filters.model}
        onChange={(e) => onFiltersChange({ ...filters, model: e.target.value })}
        className="h-7 rounded border border-gray-300 px-2 text-xs bg-white text-gray-700"
      >
        <option value="">All models</option>
        {models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  )
}
