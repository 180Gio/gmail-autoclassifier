import { describe, expect, it } from 'vitest'
import { parseFrom } from './scan.ts'

describe('parseFrom', () => {
  it('extracts a display name and lowercases the email', () => {
    expect(parseFrom('"John Doe" <John@Example.com>')).toEqual({
      name: 'John Doe',
      email: 'john@example.com',
    })
  })

  it('handles an unquoted display name', () => {
    expect(parseFrom('Tech Weekly <news@techweekly.com>')).toEqual({
      name: 'Tech Weekly',
      email: 'news@techweekly.com',
    })
  })

  it('handles a bare address', () => {
    expect(parseFrom('billing@stripe.com')).toEqual({
      name: null,
      email: 'billing@stripe.com',
    })
  })

  it('rejects values without a valid address', () => {
    expect(parseFrom('')).toBeNull()
    expect(parseFrom('not an email')).toBeNull()
    expect(parseFrom('Name <>')).toBeNull()
  })
})
