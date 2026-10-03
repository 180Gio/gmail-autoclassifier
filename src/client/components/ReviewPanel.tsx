import { useCallback, useEffect, useState } from 'react'
import type { Classification, ClassificationStatus, Label } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Badge, Button, Card, ErrorBanner, Spinner, Toggle } from './ui.tsx'

export function ReviewPanel({
  scanId,
  labels,
  filterDefaults,
  onGoToRules,
}: {
  scanId: number | null
  labels: Label[]
  filterDefaults: { archive: boolean; markRead: boolean; neverSpam: boolean; applyToExisting: boolean }
  onGoToRules: () => void
}) {
  const [items, setItems] = useState<Classification[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState(filterDefaults)
  const [applyResult, setApplyResult] = useState<string | null>(null)

  const userLabels = labels.filter((l) => l.kind === 'user').map((l) => l.name)

  const load = useCallback(async () => {
    if (!scanId) return
    setLoading(true)
    setError(null)
    try {
      setItems((await Api.classifications(scanId)).classifications)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [scanId])

  useEffect(() => {
    setApplyResult(null)
    void load()
  }, [load])

  async function guard(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const classify = () =>
    guard(async () => {
      if (!scanId) return
      setItems((await Api.classify(scanId)).classifications)
    })

  const setStatus = (row: Classification, status: ClassificationStatus) =>
    guard(async () => {
      const res = await Api.updateClassification(row.id, { status })
      setItems((prev) => prev.map((r) => (r.id === row.id ? res.classification : r)))
    })

  const toggleLabel = (row: Classification, label: string) =>
    guard(async () => {
      const next = row.labels.includes(label)
        ? row.labels.filter((l) => l !== label)
        : [...row.labels, label]
      const res = await Api.updateClassification(row.id, { labels: next })
      setItems((prev) => prev.map((r) => (r.id === row.id ? res.classification : r)))
    })

  const bulk = (status: ClassificationStatus) =>
    guard(async () => {
      if (!scanId) return
      setItems((await Api.mark(scanId, status)).classifications)
    })

  const apply = () =>
    guard(async () => {
      if (!scanId) return
      const res = await Api.apply(scanId, options)
      setApplyResult(
        `Created ${res.result.rulesCreated} filters` +
          (options.applyToExisting ? ` · ${res.result.messagesBackfilled} messages updated` : '') +
          (res.result.errors.length ? ` · ${res.result.errors.length} errors` : ''),
      )
    })

  if (!scanId) {
    return (
      <Card title="Review">
        <p className="text-sm text-slate-400 dark:text-slate-500">
          Run a scan first, then open it to classify senders.
        </p>
      </Card>
    )
  }

  const accepted = items.filter((i) => i.status === 'accepted' || i.status === 'edited').length
  const rejected = items.filter((i) => i.status === 'rejected').length

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />

      <Card
        title={`Scan #${scanId} · ${items.length} senders`}
        actions={
          <div className="flex flex-wrap gap-2">
            <Button onClick={classify} disabled={busy}>
              {busy ? <Spinner /> : null} Run AI classification
            </Button>
            <Button onClick={() => bulk('accepted')} disabled={busy}>
              Accept all
            </Button>
            <Button onClick={() => bulk('rejected')} disabled={busy}>
              Reject all
            </Button>
          </div>
        }
      >
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Badge tone="green">{accepted} accepted</Badge>
          <Badge tone="amber">{items.length - accepted - rejected} pending</Badge>
          <Badge tone="red">{rejected} rejected</Badge>
        </div>

        {loading && <Spinner />}
        <div className="space-y-3">
          {items.map((row) => (
            <ReviewRow
              key={row.id}
              row={row}
              allLabels={userLabels}
              busy={busy}
              onToggle={(label) => toggleLabel(row, label)}
              onAccept={() => setStatus(row, 'accepted')}
              onReject={() => setStatus(row, 'rejected')}
            />
          ))}
        </div>
      </Card>

      <Card title="Apply to Gmail">
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Creates Gmail filters for every accepted sender and adds the selected labels. Existing mail is
          only changed if you enable the backfill below.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <Toggle
            label="Archive classified mail (skip inbox)"
            checked={options.archive}
            onChange={(v) => setOptions({ ...options, archive: v })}
          />
          <Toggle
            label="Mark classified mail as read"
            checked={options.markRead}
            onChange={(v) => setOptions({ ...options, markRead: v })}
          />
          <Toggle
            label="Never send classified mail to spam"
            checked={options.neverSpam}
            onChange={(v) => setOptions({ ...options, neverSpam: v })}
          />
          <Toggle
            label="Also apply to existing mail (backfill)"
            checked={options.applyToExisting}
            onChange={(v) => setOptions({ ...options, applyToExisting: v })}
          />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={apply} disabled={busy || accepted === 0}>
            Apply {accepted} sender(s)
          </Button>
          {applyResult && (
            <span className="text-sm text-emerald-700 dark:text-emerald-300">{applyResult}</span>
          )}
          {applyResult && (
            <Button variant="ghost" onClick={onGoToRules}>
              View rules →
            </Button>
          )}
        </div>
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Note: Gmail filters only affect future messages unless backfill is enabled.
        </p>
      </Card>
    </div>
  )
}

function ReviewRow({
  row,
  allLabels,
  busy,
  onToggle,
  onAccept,
  onReject,
}: {
  row: Classification
  allLabels: string[]
  busy: boolean
  onToggle: (label: string) => void
  onAccept: () => void
  onReject: () => void
}) {
  const tone =
    row.status === 'accepted' || row.status === 'edited'
      ? 'green'
      : row.status === 'rejected'
        ? 'red'
        : 'amber'
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
            {row.sender?.displayName ?? row.senderEmail}
          </div>
          <div className="truncate text-xs text-slate-400 dark:text-slate-500">
            {row.senderEmail} · {row.sender?.messageCount ?? 0} messages
            {row.confidence != null && ` · confidence ${(row.confidence * 100).toFixed(0)}%`}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={tone}>{row.status}</Badge>
          <Button variant="primary" onClick={onAccept} disabled={busy}>
            Accept
          </Button>
          <Button onClick={onReject} disabled={busy}>
            Reject
          </Button>
        </div>
      </div>

      {row.rationale && (
        <p className="mt-2 text-xs italic text-slate-400 dark:text-slate-500">{row.rationale}</p>
      )}

      <div className="mt-2 flex flex-wrap gap-2">
        {allLabels.map((label) => {
          const active = row.labels.includes(label)
          return (
            <button
              key={label}
              onClick={() => onToggle(label)}
              disabled={busy}
              className={`rounded-full border px-2.5 py-0.5 text-xs transition ${
                active
                  ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-300 text-slate-500 hover:border-slate-400 dark:border-white/15 dark:text-slate-400 dark:hover:border-white/30'
              }`}
            >
              {active ? '✓ ' : '+ '}
              {label}
            </button>
          )
        })}
        {allLabels.length === 0 && (
          <span className="text-xs text-slate-400 dark:text-slate-500">No user labels available.</span>
        )}
      </div>
    </div>
  )
}
