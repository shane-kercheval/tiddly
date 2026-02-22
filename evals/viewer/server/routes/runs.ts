import { Router, type Request, type Response } from 'express'
import { readFile, writeFile } from 'node:fs/promises'
import { join, dirname, basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { glob } from 'glob'

const __dirname = dirname(fileURLToPath(import.meta.url))
const RESULT_DIRS = [
  join(__dirname, '..', '..', '..', 'content_mcp', 'results'),
  join(__dirname, '..', '..', '..', 'prompt_mcp', 'results'),
]

const router = Router()

interface ResultFile {
  path: string
  sourceDir: string
  filename: string
}

async function findAllResultFiles(): Promise<ResultFile[]> {
  const files: ResultFile[] = []
  for (const dir of RESULT_DIRS) {
    const matches = await glob('*.json', { cwd: dir, absolute: true })
    const sourceDir = basename(dirname(dir))
    for (const filePath of matches) {
      files.push({ path: filePath, sourceDir, filename: basename(filePath) })
    }
  }
  return files
}

async function findFileByEvaluationId(evaluationId: string): Promise<ResultFile | null> {
  const files = await findAllResultFiles()
  for (const file of files) {
    const raw = await readFile(file.path, 'utf-8')
    const data = JSON.parse(raw)
    if (data.evaluation_id === evaluationId) {
      return file
    }
  }
  return null
}

// GET /api/runs — list all runs (without results array)
router.get('/', async (_req: Request, res: Response) => {
  try {
    const files = await findAllResultFiles()
    const runs = []
    for (const file of files) {
      const raw = await readFile(file.path, 'utf-8')
      const data = JSON.parse(raw)
      // Compute cost/token/duration totals and extract model info from results before stripping them
      let total_cost = 0
      let total_input_tokens = 0
      let total_output_tokens = 0
      let total_duration = 0
      let sample_count = 0
      if (Array.isArray(data.results)) {
        sample_count = data.results.length
        for (const result of data.results) {
          const usage = result?.execution_context?.output?.value?.usage
          if (usage) {
            total_cost += usage.total_cost ?? 0
            total_input_tokens += usage.input_tokens ?? 0
            total_output_tokens += usage.output_tokens ?? 0
          }
          const duration = result?.execution_context?.output?.metadata?.duration_seconds
          if (typeof duration === 'number') {
            total_duration += duration
          }
        }
        // Backfill model info from first result's output when not in top-level metadata
        const firstOutput = data.results[0]?.execution_context?.output?.value
        if (firstOutput && data.metadata) {
          if (!data.metadata.model_name && firstOutput.model_name) {
            data.metadata.model_name = firstOutput.model_name
          }
          if (!data.metadata.model_provider && firstOutput.model_provider) {
            data.metadata.model_provider = firstOutput.model_provider
          }
          if (data.metadata.temperature == null && firstOutput.temperature != null) {
            data.metadata.temperature = firstOutput.temperature
          }
        }
      }
      const { results: _, ...rest } = data
      runs.push({
        ...rest,
        source_dir: file.sourceDir,
        filename: file.filename,
        total_cost,
        total_input_tokens,
        total_output_tokens,
        avg_cost: sample_count > 0 ? total_cost / sample_count : 0,
        avg_duration_seconds: sample_count > 0 ? total_duration / sample_count : 0,
      })
    }
    runs.sort((a, b) => b.started_at.localeCompare(a.started_at))
    res.json(runs)
  } catch (err) {
    console.error('Error listing runs:', err)
    res.status(500).json({ error: 'Failed to list runs' })
  }
})

// GET /api/runs/:evaluationId — full run detail
router.get('/:evaluationId', async (req: Request<{ evaluationId: string }>, res: Response) => {
  try {
    const file = await findFileByEvaluationId(req.params.evaluationId)
    if (!file) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    const raw = await readFile(file.path, 'utf-8')
    const data = JSON.parse(raw)
    res.json(data)
  } catch (err) {
    console.error('Error fetching run:', err)
    res.status(500).json({ error: 'Failed to fetch run' })
  }
})

// PATCH /api/runs/:evaluationId/annotations — update annotation
router.patch('/:evaluationId/annotations', async (req: Request<{ evaluationId: string }>, res: Response) => {
  try {
    const file = await findFileByEvaluationId(req.params.evaluationId)
    if (!file) {
      res.status(404).json({ error: 'Run not found' })
      return
    }
    const raw = await readFile(file.path, 'utf-8')
    const data = JSON.parse(raw)
    if (!data.metadata) {
      data.metadata = {}
    }
    data.metadata.annotation = req.body.annotation
    await writeFile(file.path, JSON.stringify(data, null, 2) + '\n')
    res.json({ ok: true })
  } catch (err) {
    console.error('Error updating annotation:', err)
    res.status(500).json({ error: 'Failed to update annotation' })
  }
})

export default router
