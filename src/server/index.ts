import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express from 'express'
import { getDb } from './db.ts'
import { IS_PROD, PORT, WEB_ORIGIN } from './env.ts'
import { errorHandler, notFound } from './http.ts'
import { authRouter } from './routes/auth.ts'
import { labelsRouter } from './routes/labels.ts'
import { rulesRouter } from './routes/rules.ts'
import { scansRouter } from './routes/scans.ts'
import { settingsRouter } from './routes/settings.ts'
import { statusRouter } from './routes/status.ts'

const app = express()
app.use(express.json({ limit: '5mb' }))

// Development: Vite proxies /api, so CORS is only a convenience for direct calls.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', WEB_ORIGIN)
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS')
  if (req.method === 'OPTIONS') {
    res.sendStatus(204)
    return
  }
  next()
})

app.use(
  '/api',
  statusRouter,
  settingsRouter,
  authRouter,
  labelsRouter,
  scansRouter,
  rulesRouter,
)
app.use('/api', notFound)

// Serve the built client when available (npm run build && npm start).
const clientDir = join(process.cwd(), 'dist', 'client')
if (existsSync(clientDir)) {
  app.use(express.static(clientDir))
  app.get(/.*/, (_req, res) => {
    res.sendFile(join(clientDir, 'index.html'))
  })
}

app.use(errorHandler)

getDb()

const server = app.listen(PORT, () => {
  const mode = IS_PROD ? 'production' : 'development'
  console.log(`Gmail AutoClassifier API listening on http://localhost:${PORT} (${mode})`)
})

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `\nPort ${PORT} is already in use — another instance is probably still running.\n` +
        `Stop it, or set a different PORT in .env.\n`,
    )
  } else {
    console.error(error)
  }
  process.exit(1)
})
