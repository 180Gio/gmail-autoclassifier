import { randomUUID } from 'node:crypto'
import { getSetting } from '../../settings.ts'
import type { AiProvider, GenerateRequest } from '../types.ts'

/**
 * OpenCode Go: the hosted OpenCode subscription. No local server required —
 * just an API key. Endpoint and auth documented at
 * https://opencode.ai/v2/docs/console/go
 *
 *   Base URL: https://opencode.ai/zen/go/v1
 *   Auth:     Authorization: Bearer <api key>
 *   API:      POST /chat/completions  (OpenAI-compatible)
 *
 * Go asks clients to identify themselves with their own user agent and to send
 * a stable session id in `x-opencode-session` (used for routing and prompt
 * caching). Both are set here.
 *
 * Note: a few Go models (MiniMax, Qwen) are only served on the Anthropic-native
 * `/messages` endpoint and are therefore not supported by this provider.
 */
export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

const CLIENT_USER_AGENT = 'gmail-autoclassifier/0.1.0'

export function opencodeGoProvider(): AiProvider {
  const apiKey = () => getSetting('ai.opencode-go.apiKey')
  const model = () => getSetting('ai.opencode-go.model') ?? 'deepseek-v4.1-flash'

  function headers(sessionId?: string): Record<string, string> {
    const h: Record<string, string> = {
      'content-type': 'application/json',
      'user-agent': CLIENT_USER_AGENT,
    }
    const key = apiKey()
    if (key) h.authorization = `Bearer ${key}`
    h['x-opencode-session'] = sessionId ?? randomUUID()
    return h
  }

  return {
    id: 'opencode-go',
    label: 'OpenCode Go',
    get ready() {
      return Boolean(apiKey() && model())
    },
    async generate(req: GenerateRequest): Promise<string> {
      const messages: Array<{ role: string; content: string }> = []
      if (req.system) messages.push({ role: 'system', content: req.system })
      messages.push({ role: 'user', content: req.prompt })

      const body: Record<string, unknown> = {
        model: model(),
        messages,
        temperature: req.temperature ?? 0.2,
      }
      if (req.json) body.response_format = { type: 'json_object' }

      const res = await fetch(`${OPENCODE_GO_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: headers(req.sessionId),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`OpenCode Go request failed (${res.status}): ${await safeText(res)}`)
      }
      const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
      return json.choices?.[0]?.message?.content ?? ''
    },
    async listModels() {
      const res = await fetch(`${OPENCODE_GO_BASE_URL}/models`, { headers: headers() })
      if (!res.ok) throw new Error(`OpenCode Go model list failed (${res.status})`)
      const json = (await res.json()) as { data?: Array<{ id: string }> }
      return (json.data ?? []).map((m) => ({ id: m.id, label: m.id }))
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
