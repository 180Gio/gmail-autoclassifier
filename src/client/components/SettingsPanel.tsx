import { useEffect, useState } from 'react'
import type { SettingView } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Button, Card, ErrorBanner, Field, Input, Select, SuccessBanner, Toggle } from './ui.tsx'

const GROUP_TITLES: Record<string, string> = {
  google: 'Google OAuth',
  ai: 'AI provider',
  scan: 'Scanning defaults',
  filters: 'Filter action defaults',
}

const GROUP_HINTS: Record<string, string> = {
  google:
    'Create OAuth credentials in Google Cloud Console (Gmail API enabled) and use the redirect URI shown below.',
  ai: 'Secrets are encrypted at rest in the local database. Switch provider at any time.',
  scan: 'Used as the default values when starting a new scan.',
  filters: 'Default actions proposed when you apply filters. You can still override them per apply.',
}

export function SettingsPanel({
  settings,
  onSaved,
}: {
  settings: SettingView[]
  onSaved: (settings: SettingView[]) => void
}) {
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const setting of settings) {
      if (setting.type !== 'secret') next[setting.key] = setting.value ?? ''
    }
    setDraft(next)
    setSecrets({})
  }, [settings])

  function value(key: string): string {
    return draft[key] ?? ''
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const patch: Record<string, unknown> = { ...draft }
      for (const [key, val] of Object.entries(secrets)) {
        if (val) patch[key] = val
      }
      const res = await Api.saveSettings(patch)
      onSaved(res.settings)
      setSecrets({})
      setSuccess('Settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    try {
      const res = await Api.testAi()
      setTestResult(`✅ ${res.provider} replied: "${res.text ?? ''}"`)
    } catch (err) {
      setTestResult(`❌ ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setTesting(false)
    }
  }

  const groups = ['google', 'ai', 'scan', 'filters']
  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />
      <SuccessBanner message={success} />

      {groups.map((group) => {
        const items = settings.filter((s) => s.group === group)
        if (items.length === 0) return null
        return (
          <Card key={group} title={GROUP_TITLES[group] ?? group}>
            <p className="mb-4 text-xs text-slate-500">{GROUP_HINTS[group]}</p>
            <div className="grid gap-4 md:grid-cols-2">
              {items.map((setting) => (
                <SettingField
                  key={setting.key}
                  setting={setting}
                  value={value(setting.key)}
                  secret={secrets[setting.key] ?? ''}
                  onChange={(v) => setDraft((d) => ({ ...d, [setting.key]: v }))}
                  onSecretChange={(v) => setSecrets((s) => ({ ...s, [setting.key]: v }))}
                />
              ))}
            </div>
          </Card>
        )
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={busy}>
          Save settings
        </Button>
        <Button onClick={test} disabled={testing}>
          Test AI provider
        </Button>
        {testResult && <span className="text-sm text-slate-600">{testResult}</span>}
      </div>
    </div>
  )
}

function SettingField({
  setting,
  value,
  secret,
  onChange,
  onSecretChange,
}: {
  setting: SettingView
  value: string
  secret: string
  onChange: (value: string) => void
  onSecretChange: (value: string) => void
}) {
  if (setting.type === 'boolean') {
    return (
      <div className="flex items-end">
        <Toggle
          label={setting.label}
          checked={value === 'true'}
          onChange={(v) => onChange(v ? 'true' : 'false')}
        />
      </div>
    )
  }

  if (setting.type === 'secret') {
    return (
      <Field
        label={setting.label}
        help={setting.hasValue ? 'A value is stored. Type to replace it.' : setting.help}
      >
        <Input
          type="password"
          value={secret}
          placeholder={setting.hasValue ? '••••••••' : 'Not set'}
          onChange={(e) => onSecretChange(e.target.value)}
          autoComplete="new-password"
        />
      </Field>
    )
  }

  if (setting.type === 'select') {
    return (
      <Field label={setting.label} help={setting.help}>
        <Select value={value} onChange={(e) => onChange(e.target.value)}>
          {(setting.options ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </Field>
    )
  }

  return (
    <Field label={setting.label} help={setting.help}>
      <Input
        type={setting.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  )
}
