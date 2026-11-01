import { describe, expect, it } from 'vitest'
import { coerceSettingValue } from './settings.ts'

describe('coerceSettingValue', () => {
  it('validates numbers', () => {
    expect(coerceSettingValue('number', '4')).toBe('4')
    expect(coerceSettingValue('number', '4.5')).toBe('4.5')
    expect(coerceSettingValue('number', 'abc')).toBeNull()
  })

  it('validates booleans', () => {
    expect(coerceSettingValue('boolean', 'true')).toBe('true')
    expect(coerceSettingValue('boolean', 'false')).toBe('false')
    expect(coerceSettingValue('boolean', 'yes')).toBeNull()
  })

  it('passes through strings and selects', () => {
    expect(coerceSettingValue('string', 'hello')).toBe('hello')
    expect(coerceSettingValue('select', 'opencode-go')).toBe('opencode-go')
  })
})
