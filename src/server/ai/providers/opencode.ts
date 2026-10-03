import { getSetting } from '../../settings.ts'
import type { AiProvider, GenerateRequest } from '../types.ts'

/**
 * Provider backed by a running OpenCode server, using its one-shot
 * generation endpoint:
 *
 *   POST {baseUrl}/api/experimental/generate
 *   body: { prompt, model?: { providerID, id, variant? } }
 *   ->   { data: { text } }
 *
 * Requires `opencode serve` to be running.
 */
export function opencodeProvider(): AiProvider {
  const baseUrl = () => (getSetting('ai.opencode.baseUrl') ?? 'http://localhost:4096').replace(/\/+$/, '')
  const token = () => getSetting('ai.opencode.token')

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    const t = token()
    if (t) h.authorization = `Bearer ${t}`
    return h
  }

  /** Parse "provider/model#variant" into a Model.Ref. */
  function modelRef(): { providerID: string; id: string; variant?: string } | undefined {
    const raw = getSetting('ai.opencode.model')
    if (!raw) return undefined
    const [providerPart, rest] = raw.includes('/') ? raw.split(/[/](.*)/s) : ['', raw]
    if (!providerPart || !rest) return undefined
    const [id, variant] = rest.split('#', 2)
    return variant ? { providerID: providerPart, id, variant } : { providerID: providerPart, id }
  }

  return {
    id: 'opencode',
    label: 'OpenCode',
    get ready() {
      return Boolean(getSetting('ai.opencode.baseUrl'))
    },
    async generate(req: GenerateRequest): Promise<string> {
      const body: Record<string, unknown> = {
        prompt: req.system ? `${req.system}\n\n${req.prompt}` : req.prompt,
      }
      const model = modelRef()
      if (model) body.model = model

      const res = await fetch(`${baseUrl()}/api/experimental/generate`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`OpenCode generate failed (${res.status}): ${await safeText(res)}`)
      }
      const json = (await res.json()) as { data?: { text?: string } }
      return json.data?.text ?? ''
    },
    async listModels() {
      const res = await fetch(`${baseUrl()}/api/model`, { headers: headers() })
      if (!res.ok) throw new Error(`OpenCode model list failed (${res.status})`)
      const json = (await res.json()) as unknown
      const list = Array.isArray(json)
        ? json
        : ((json as { data?: unknown[] }).data ?? [])
      return (list as Array<Record<string, unknown>>).map((m) => ({
        id: `${String(m.providerID ?? '')}/${String(m.modelID ?? m.id ?? '')}`,
        label: String(m.name ?? m.modelID ?? m.id ?? ''),
      }))
    },
  }
}

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300)
  } catch {
    return ''
  }
}
