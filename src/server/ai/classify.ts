import { getProvider } from './index.ts'
import type { GenerateRequest } from './types.ts'

export interface ClassifyLabelInput {
  name: string
  description: string
}

export interface ClassifySenderInput {
  email: string
  displayName?: string | null
  messageCount: number
  sampleSubjects: string[]
}

export interface ClassifyOptions {
  labels: ClassifyLabelInput[]
  senders: ClassifySenderInput[]
  /** Model identifier recorded on the results (informational). */
  model?: string | null
}

export interface SenderClassification {
  senderEmail: string
  labels: string[]
  confidence: number
  rationale: string
}

const SYSTEM_PROMPT =
  'You organize Gmail inboxes. You receive a list of the user\'s labels, each with a ' +
  'description of what belongs in it, and a list of email senders with sample subjects. ' +
  'Assign the most appropriate label(s) to each sender.'

const CHUNK_SIZE = 25

/**
 * Classify senders into labels. Senders are processed in small chunks for
 * reliability, and label names are validated against the provided list so the
 * model cannot invent new labels.
 */
export async function classifySenders(options: ClassifyOptions): Promise<SenderClassification[]> {
  const { labels, senders } = options
  if (senders.length === 0) return []

  // The mock provider is offline: use a deterministic local heuristic so the
  // whole flow can be exercised without any external service.
  const provider = getProvider()
  if (provider.id === 'mock') {
    return senders.map((s) => heuristicClassify(s, labels))
  }

  const byEmail = new Map<string, ClassifySenderInput>(senders.map((s) => [s.email, s]))
  const known = new Map(labels.map((l) => [l.name.toLowerCase(), l.name]))
  const results: SenderClassification[] = []

  for (let i = 0; i < senders.length; i += CHUNK_SIZE) {
    const chunk = senders.slice(i, i + CHUNK_SIZE)
    const req: GenerateRequest = {
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(labels, chunk),
      json: true,
      temperature: 0.1,
    }

    let raw = await provider.generate(req)
    let parsed = safeParse(raw, known, byEmail)
    if (parsed === null) {
      // One retry with a stricter nudge before giving up on this chunk.
      raw = await provider.generate({
        ...req,
        prompt: `${req.prompt}\n\nIMPORTANT: reply with a single raw JSON array and nothing else.`,
      })
      parsed = safeParse(raw, known, byEmail)
    }
    if (parsed) results.push(...parsed)
  }

  return results
}

function buildPrompt(labels: ClassifyLabelInput[], senders: ClassifySenderInput[]): string {
  const labelBlock = labels
    .map((l) => `- "${l.name}": ${l.description || '(no description provided)'}`)
    .join('\n')

  const senderBlock = senders
    .map((s) =>
      JSON.stringify({
        sender: s.email,
        name: s.displayName ?? undefined,
        count: s.messageCount,
        subjects: s.sampleSubjects.slice(0, 5),
      }),
    )
    .join('\n')

  return [
    'Available labels:',
    labelBlock,
    '',
    'Senders to classify (one JSON object per line):',
    senderBlock,
    '',
    'Rules:',
    '- Use only the exact label names listed above.',
    '- A sender may get zero, one, or more labels.',
    '- Use an empty array when no label clearly fits.',
    '- confidence is a number between 0 and 1.',
    '- rationale is a very short reason (max 15 words).',
    '',
    'Reply with a single JSON array, no markdown, in this exact shape:',
    '[{"sender":"a@b.com","labels":["Newsletters"],"confidence":0.9,"rationale":"Weekly tech digest"}]',
  ].join('\n')
}

interface RawItem {
  sender?: unknown
  labels?: unknown
  confidence?: unknown
  rationale?: unknown
}

function safeParse(
  text: string,
  known: Map<string, string>,
  byEmail: Map<string, ClassifySenderInput>,
): SenderClassification[] | null {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  let items: RawItem[]
  try {
    items = JSON.parse(text.slice(start, end + 1)) as RawItem[]
  } catch {
    return null
  }
  if (!Array.isArray(items)) return null

  const out: SenderClassification[] = []
  for (const item of items) {
    const email = String(item.sender ?? '').trim().toLowerCase()
    if (!email || !byEmail.has(email)) continue
    const labels = Array.isArray(item.labels)
      ? item.labels
          .map((l) => known.get(String(l).trim().toLowerCase()))
          .filter((l): l is string => Boolean(l))
      : []
    const confidenceRaw = Number(item.confidence)
    const confidence = Number.isFinite(confidenceRaw)
      ? Math.min(1, Math.max(0, confidenceRaw))
      : 0.5
    out.push({
      senderEmail: email,
      labels: [...new Set(labels)],
      confidence,
      rationale: String(item.rationale ?? '').slice(0, 200),
    })
  }
  return out
}

/** Simple keyword-based fallback used by the mock provider. */
function heuristicClassify(
  sender: ClassifySenderInput,
  labels: ClassifyLabelInput[],
): SenderClassification {
  const haystack = [sender.email, sender.displayName ?? '', ...sender.sampleSubjects]
    .join(' ')
    .toLowerCase()
  let best: { name: string; score: number } | null = null
  for (const label of labels) {
    const words = `${label.name} ${label.description}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3)
    const score = words.reduce((acc, w) => (haystack.includes(w) ? acc + 1 : acc), 0)
    if (score > 0 && (!best || score > best.score)) best = { name: label.name, score }
  }
  return {
    senderEmail: sender.email,
    labels: best ? [best.name] : [],
    confidence: best ? Math.min(0.6, 0.2 + best.score * 0.1) : 0,
    rationale: best ? 'Matched by local keyword heuristic (mock provider).' : 'No keyword match.',
  }
}
