import express from 'express'
import runsRouter from './routes/runs.js'

const app = express()
app.use(express.json())
app.use('/api/runs', runsRouter)

const PORT = 3001
app.listen(PORT, () => {
  console.log(`Eval viewer API running on http://localhost:${PORT}`)
})
