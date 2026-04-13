export interface CheckResult {
  check_type: string
  check_version: string
  status: 'completed' | 'error'
  results: {
    passed: boolean
    [key: string]: unknown
  }
  resolved_arguments: Record<string, unknown>
  evaluated_at: string
  metadata: {
    name?: string
    description?: string
  } | null
  error: unknown
}

export interface SampleSummary {
  total_checks: number
  completed_checks: number
  error_checks: number
}

export interface TestCase {
  id: string
  input: Record<string, unknown>
  expected: Record<string, unknown>
  metadata?: {
    description?: string
  } | null
  checks: unknown
}

export interface TestOutput {
  value: Record<string, unknown>
  id: string | null
  metadata?: {
    duration_seconds?: number
  }
}

export interface ExecutionContext {
  test_case: TestCase
  output: TestOutput
}

export interface SampleResult {
  status: 'completed' | 'error'
  execution_context: ExecutionContext
  check_results: CheckResult[]
  summary: SampleSummary
  metadata: unknown
}

export interface RunSummary {
  total_test_cases: number
  completed_test_cases: number
  error_test_cases: number
}

export interface TestConfig {
  test_function: string
  test_module: string
  samples: number
  pass_threshold: number
  pass_mode: string
  num_test_cases: number
}

export interface TestResults {
  pass_mode: string
  pass_threshold: number
  passed: boolean
  // Sample-level stats
  passed_samples: number
  failed_samples: number
  total_samples: number
  sample_pass_rate: number
  // Per-test-case stats
  per_test_case?: Array<{
    index: number
    id: string | null
    passed: number
    failed: number
    total: number
    rate: number
  }>
  failed_test_cases?: Array<{
    index: number
    id: string | null
  }>
  // Legacy field for old results
  success_rate?: number
}

export interface RunMetadata {
  model_provider?: string
  model_name?: string
  _test_config: TestConfig
  _test_results: TestResults
  annotation?: string
  eval_name?: string
  eval_description?: string
  temperature?: number
}

export interface EvalRun {
  evaluation_id: string
  started_at: string
  completed_at: string
  status: 'completed' | 'error'
  summary: RunSummary
  results: SampleResult[]
  metadata: RunMetadata
}

export interface EvalRunListItem {
  evaluation_id: string
  started_at: string
  completed_at: string
  status: 'completed' | 'error'
  summary: RunSummary
  metadata: RunMetadata
  source_dir: string
  filename: string
  total_cost?: number
  total_input_tokens?: number
  total_output_tokens?: number
  avg_cost?: number
  avg_duration_seconds?: number
}
