import type { EvalRun, EvalRunListItem } from '../types'

export async function fetchRuns(): Promise<EvalRunListItem[]> {
  const res = await fetch('/api/runs')
  if (!res.ok) throw new Error(`Failed to fetch runs: ${res.status}`)
  return res.json()
}

export async function fetchRun(evaluationId: string): Promise<EvalRun> {
  const res = await fetch(`/api/runs/${evaluationId}`)
  if (!res.ok) throw new Error(`Failed to fetch run: ${res.status}`)
  return res.json()
}

export async function updateAnnotation(evaluationId: string, annotation: string): Promise<void> {
  const res = await fetch(`/api/runs/${evaluationId}/annotations`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ annotation }),
  })
  if (!res.ok) throw new Error(`Failed to update annotation: ${res.status}`)
}
