import { describe, expect, it } from 'vitest'
import {
  parseClassificationResponse,
  type ClassifyLabelInput,
  type ClassifySenderInput,
} from './classify.ts'

const labels: ClassifyLabelInput[] = [
  { name: 'Newsletters', description: 'Weekly digests' },
  { name: 'Invoices', description: 'Billing and receipts' },
]

const senders: ClassifySenderInput[] = [
  { email: 'news@techweekly.com', displayName: 'Tech Weekly', messageCount: 12, sampleSubjects: ['AI roundup'] },
  { email: 'billing@stripe.com', displayName: 'Stripe', messageCount: 3, sampleSubjects: ['Invoice'] },
]

describe('parseClassificationResponse', () => {
  it('parses a bare JSON array', () => {
    const raw =
      '[{"sender":"news@techweekly.com","labels":["Newsletters"],"confidence":0.9,"rationale":"digest"}]'
    const result = parseClassificationResponse(raw, labels, senders)
    expect(result).toEqual([
      {
        senderEmail: 'news@techweekly.com',
        labels: ['Newsletters'],
        confidence: 0.9,
        rationale: 'digest',
      },
    ])
  })

  it('parses a JSON object containing an array', () => {
    const raw =
      '{"classifications":[{"sender":"billing@stripe.com","labels":["Invoices"],"confidence":0.8,"rationale":"invoice"}]}'
    const result = parseClassificationResponse(raw, labels, senders)
    expect(result?.[0]?.labels).toEqual(['Invoices'])
  })

  it('tolerates markdown code fences', () => {
    const raw =
      '```json\n[{"sender":"news@techweekly.com","labels":["Newsletters"],"confidence":0.7,"rationale":"x"}]\n```'
    const result = parseClassificationResponse(raw, labels, senders)
    expect(result?.[0]?.senderEmail).toBe('news@techweekly.com')
  })

  it('drops unknown labels and unknown senders', () => {
    const raw = JSON.stringify([
      { sender: 'news@techweekly.com', labels: ['Made Up'], confidence: 0.9 },
      { sender: 'stranger@example.com', labels: ['Invoices'], confidence: 0.9 },
    ])
    const result = parseClassificationResponse(raw, labels, senders)
    expect(result).toEqual([
      {
        senderEmail: 'news@techweekly.com',
        labels: [],
        confidence: 0.9,
        rationale: '',
      },
    ])
  })

  it('clamps confidence into 0..1', () => {
    const raw = JSON.stringify([
      { sender: 'news@techweekly.com', labels: ['Newsletters'], confidence: 4 },
      { sender: 'billing@stripe.com', labels: ['Invoices'], confidence: -2 },
    ])
    const result = parseClassificationResponse(raw, labels, senders)
    expect(result?.[0]?.confidence).toBe(1)
    expect(result?.[1]?.confidence).toBe(0)
  })

  it('returns null for unparseable responses', () => {
    expect(parseClassificationResponse('{"type":"json_object" }', labels, senders)).toBeNull()
    expect(parseClassificationResponse('sorry, I cannot help with that', labels, senders)).toBeNull()
  })
})
