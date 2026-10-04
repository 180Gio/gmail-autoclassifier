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

const PROVIDER_NOTES: Record<string, string> = {
  opencode:
    'OpenCode is a server (usually local). The URL is the address of that server; the API key is only a credential for servers that require authentication — for a local server without auth, leave it empty. The model provider keys (Anthropic, OpenAI, …) live in OpenCode itself.',
  'opencode-go':
    'Hosted OpenCode Go subscription — no local server or OpenCode installation needed. Paste your API key from the OpenCode Console. Requests go to the OpenAI-compatible endpoint https://opencode.ai/zen/go/v1.',
  openai:
    'Any OpenAI-compatible endpoint, including local servers such as Ollama (http://localhost:11434/v1) where the API key can be left empty.',
  mock: 'Offline provider using a local keyword heuristic. For testing the flow only — no API key needed.',
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

  const selectedProvider = draft['ai.provider'] ?? 'opencode'

  function value(key: string): string {
    return draft[key] ?? ''
  }

  /** Only the selected provider's fields are shown. */
  function isVisible(setting: SettingView): boolean {
    if (setting.group !== 'ai') return true
    if (setting.key === 'ai.provider') return true
    return setting.key.startsWith(`ai.${selectedProvider}.`)
  }

  function buildPatch(): Record<string, unknown> {
    const patch: Record<string, unknown> = {}
    for (const setting of settings) {
      // Read-only values (e.g. the redirect URI) are never persisted so the
      // environment variable keeps working as an override.
      if (setting.readOnly || setting.type === 'secret') continue
      patch[setting.key] = draft[setting.key] ?? ''
    }
    for (const [key, val] of Object.entries(secrets)) {
      if (val) patch[key] = val
    }
    return patch
  }

  async function save() {
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      const res = await Api.saveSettings(buildPatch())
      onSaved(res.settings)
      setSecrets({})
      setSuccess('Settings saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function saveAndTest() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      // Persist first so the test uses exactly what is shown in the form.
      const res = await Api.saveSettings(buildPatch())
      onSaved(res.settings)
      setSecrets({})
      const test = await Api.testAi()
      setTestResult(`✅ ${test.provider} replied: "${test.text ?? ''}"`)
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
        const items = settings.filter((s) => s.group === group && isVisible(s))
        if (items.length === 0) return null
        return (
          <Card key={group} title={GROUP_TITLES[group] ?? group}>
            <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">{GROUP_HINTS[group]}</p>
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
            {group === 'ai' && (
              <p className="mt-4 rounded-lg bg-indigo-500/10 px-3 py-2 text-xs text-indigo-700 dark:text-indigo-300">
                {PROVIDER_NOTES[selectedProvider] ?? ''}
              </p>
            )}
          </Card>
        )
      })}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={save} disabled={busy}>
          Save settings
        </Button>
        <Button onClick={saveAndTest} disabled={testing || busy}>
          {testing ? 'Testing…' : 'Save & test AI provider'}
        </Button>
        {testResult && <span className="text-sm text-slate-600 dark:text-slate-300">{testResult}</span>}
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
  const [copied, setCopied] = useState(false)

  if (setting.readOnly) {
    function copy() {
      const promise = navigator.clipboard?.writeText(value)
      if (!promise) return
      void promise
        .then(() => {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        })
        .catch(() => {})
    }
    return (
      <Field label={setting.label} help={setting.help}>
        <div className="flex items-center gap-2">
          <Input value={value} readOnly className="font-mono text-xs" />
          <Button type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Field>
    )
  }

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
