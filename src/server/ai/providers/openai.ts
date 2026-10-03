import { getSetting } from '../../settings.ts'
import type { AiProvider, GenerateRequest } from '../types.ts'

/**
 * Provider for any OpenAI-compatible Chat Completions endpoint:
 * OpenAI, OpenRouter, Groq, Together, Ollama (`/v1`), LM Studio, vLLM, ...
 */
export function openaiProvider(): AiProvider {
  const baseUrl = () => (getSetting('ai.openai.baseUrl') ?? 'https://api.openai.com/v1').replace(/\/+$/, '')
  const apiKey = () => getSetting('ai.openai.apiKey')
  const model = () => getSetting('ai.openai.model') ?? 'gpt-4o-mini'

  function headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' }
    const key = apiKey()
    if (key) h.authorization = `Bearer ${key}`
    return h
  }

  return {
    id: 'openai',
    label: 'OpenAI-compatible',
    get ready() {
      return Boolean(getSetting('ai.openai.baseUrl') && getSetting('ai.openai.model'))
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

      const res = await fetch(`${baseUrl()}/chat/completions`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`OpenAI-compatible request failed (${res.status}): ${await safeText(res)}`)
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      return json.choices?.[0]?.message?.content ?? ''
    },
    async listModels() {
      const res = await fetch(`${baseUrl()}/models`, { headers: headers() })
      if (!res.ok) throw new Error(`Model list failed (${res.status})`)
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
