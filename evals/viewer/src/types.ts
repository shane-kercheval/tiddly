export interface CheckResult {
  check_type: string
  check_version: string
  status: 'completed' | 'error'
  results: {
    passed: boolean
    found?: string[]
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
  metadata: {
    description: string
  }
  checks: unknown
}

export interface TestOutput {
  value: Record<string, unknown>
  id: string | null
  metadata: {
    duration_seconds: number
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
  success_threshold: number
  num_test_cases: number
}

export interface TestResults {
  passed_samples: number
  failed_samples: number
  total_samples: number
  success_rate: number
  success_threshold: number
  passed: boolean
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
}
