import { useState, useEffect, useCallback } from 'react'
import type { EvalRun, EvalRunListItem } from '../types'
import { fetchRuns as apiFetchRuns, fetchRun as apiFetchRun } from '../services/api'

export function useRuns(): { runs: EvalRunListItem[]; loading: boolean; error: string | null } {
  const [runs, setRuns] = useState<EvalRunListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetchRuns()
      .then(setRuns)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return { runs, loading, error }
}

export function useRun(evaluationId: string | undefined): {
  run: EvalRun | null
  loading: boolean
  error: string | null
  refetch: () => void
} {
  const [run, setRun] = useState<EvalRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(() => {
    if (!evaluationId) return
    setLoading(true)
    apiFetchRun(evaluationId)
      .then(setRun)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [evaluationId])

  useEffect(() => {
    refetch()
  }, [refetch])

  return { run, loading, error, refetch }
}
