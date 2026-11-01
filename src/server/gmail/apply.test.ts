import { describe, expect, it } from 'vitest'
import { parseFilterSenders, planFilters } from './apply.ts'

const mappings = [
  { senderEmail: 'a@x.com', labels: ['Newsletters'] },
  { senderEmail: 'b@x.com', labels: ['Newsletters', 'Invoices'] },
  { senderEmail: 'a@x.com', labels: ['Newsletters'] },
]

describe('planFilters', () => {
  it('groups by label, dedupes senders and builds the OR query', () => {
    const groups = planFilters(mappings, 50)
    const newsletters = groups.find((g) => g.label === 'Newsletters')
    expect(newsletters?.senders).toEqual(['a@x.com', 'b@x.com'])
    expect(newsletters?.fromQuery).toBe('a@x.com OR b@x.com')

    const invoices = groups.find((g) => g.label === 'Invoices')
    expect(invoices?.senders).toEqual(['b@x.com'])
  })

  it('splits a label into chunks', () => {
    const groups = planFilters(mappings, 1)
    expect(groups).toHaveLength(3)
    expect(groups.map((g) => g.fromQuery)).toEqual(['a@x.com', 'b@x.com', 'b@x.com'])
  })

  it('returns no groups when nothing is accepted', () => {
    expect(planFilters([], 50)).toEqual([])
  })

  it('falls back to a sane chunk size for invalid input', () => {
    expect(planFilters(mappings, 0).length).toBeGreaterThan(0)
  })
})

describe('parseFilterSenders', () => {
  it('splits an OR list into lowercase addresses', () => {
    expect(parseFilterSenders('A@X.com OR b@x.com OR  c@x.com')).toEqual([
      'a@x.com',
      'b@x.com',
      'c@x.com',
    ])
  })

  it('handles a single address and empty input', () => {
    expect(parseFilterSenders('a@x.com')).toEqual(['a@x.com'])
    expect(parseFilterSenders(null)).toEqual([])
    expect(parseFilterSenders('')).toEqual([])
  })

  it('ignores non-address parts', () => {
    expect(parseFilterSenders('not-an-email OR a@x.com')).toEqual(['a@x.com'])
  })
})
