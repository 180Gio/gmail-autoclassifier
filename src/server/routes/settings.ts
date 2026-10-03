import { Router } from 'express'
import { getProvider } from '../ai/index.ts'
import { getSettingsView, saveSettings } from '../settings.ts'

export const settingsRouter: Router = Router()

settingsRouter.get('/settings', (_req, res) => {
  res.json({ settings: getSettingsView() })
})

settingsRouter.put('/settings', (req, res) => {
  const values = (req.body ?? {}) as Record<string, unknown>
  saveSettings(values)
  res.json({ settings: getSettingsView() })
})

/** Quick check that the selected provider actually answers. */
settingsRouter.post('/settings/test-ai', async (_req, res) => {
  const provider = getProvider()
  try {
    const text = await provider.generate({
      prompt: 'Reply with exactly one word: ok',
      temperature: 0,
    })
    res.json({ ok: true, provider: provider.label, text: text.trim().slice(0, 200) })
  } catch (error) {
    res.status(502).json({
      ok: false,
      provider: provider.label,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})

settingsRouter.get('/settings/models', async (_req, res) => {
  const provider = getProvider()
  if (!provider.listModels) {
    res.json({ models: [] })
    return
  }
  try {
    res.json({ models: await provider.listModels() })
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) })
  }
})
