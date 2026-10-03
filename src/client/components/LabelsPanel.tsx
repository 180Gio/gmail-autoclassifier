import { useState } from 'react'
import type { Label } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Badge, Button, Card, ErrorBanner, Input } from './ui.tsx'

export function LabelsPanel({ labels, onChange }: { labels: Label[]; onChange: (labels: Label[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  const userLabels = labels.filter((l) => l.kind === 'user')
  const systemLabels = labels.filter((l) => l.kind === 'system')

  async function run<T>(fn: () => Promise<T>, apply: (result: T) => void) {
    setBusy(true)
    setError(null)
    try {
      apply(await fn())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  async function sync() {
    await run(
      () => Api.syncLabels(),
      (res) => onChange(res.labels),
    )
  }

  async function create() {
    if (!newName.trim()) return
    await run(
      () => Api.createLabel(newName.trim(), newDescription),
      (res) => onChange([...labels, res.label]),
    )
    setNewName('')
    setNewDescription('')
  }

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />

      <Card
        title={`Your labels (${userLabels.length})`}
        actions={
          <Button onClick={sync} disabled={busy}>
            Sync from Gmail
          </Button>
        }
      >
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Write a short description of what belongs in each label. The AI uses these descriptions to
          decide where each sender goes.
        </p>
        <div className="space-y-5">
          {userLabels.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              No user labels yet. Create one below or sync from Gmail.
            </p>
          )}
          {userLabels.map((label) => (
            <LabelEditor
              key={label.id}
              label={label}
              onSaved={(l) => onChange(labels.map((x) => (x.id === l.id ? l : x)))}
            />
          ))}
        </div>
      </Card>

      <Card title="Create a new label">
        <div className="grid gap-3 md:grid-cols-[1fr_2fr_auto] md:items-start">
          <Input placeholder="Label name" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <Input
            placeholder="Description (e.g. invoices from SaaS tools)"
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
          />
          <Button variant="primary" onClick={create} disabled={busy || !newName.trim()}>
            Add label
          </Button>
        </div>
      </Card>

      {systemLabels.length > 0 && (
        <Card title={`System labels (${systemLabels.length})`}>
          <div className="flex flex-wrap gap-2">
            {systemLabels.map((l) => (
              <Badge key={l.id}>{l.name}</Badge>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}

function LabelEditor({ label, onSaved }: { label: Label; onSaved: (label: Label) => void }) {
  const [description, setDescription] = useState(label.description)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dirty = description !== label.description

  async function save() {
    setSaving(true)
    setError(null)
    try {
      const res = await Api.updateLabel(label.id, { description })
      onSaved(res.label)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{label.name}</span>
        {label.createdByApp && <Badge tone="indigo">created by app</Badge>}
        {label.gmailId && <Badge tone="green">in Gmail</Badge>}
      </div>
      <div className="flex items-start gap-2">
        <Input
          placeholder="Describe what belongs here..."
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <Button variant="primary" onClick={save} disabled={saving || !dirty}>
          Save
        </Button>
      </div>
      {error && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  )
}
