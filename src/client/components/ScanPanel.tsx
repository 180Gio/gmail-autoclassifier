import { useEffect, useRef, useState } from 'react'
import type { Scan } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Badge, Button, Card, ErrorBanner, Field, Input, Spinner } from './ui.tsx'

export function ScanPanel({
  scans,
  activeScanId,
  defaults,
  onScansChange,
  onSelectScan,
  onGoToReview,
}: {
  scans: Scan[]
  activeScanId: number | null
  defaults: { months: number; maxMessages: number }
  onScansChange: (scans: Scan[]) => void
  onSelectScan: (id: number) => void
  onGoToReview: () => void
}) {
  const [months, setMonths] = useState(String(defaults.months))
  const [maxMessages, setMaxMessages] = useState(String(defaults.maxMessages))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  const active = scans.find((s) => s.id === activeScanId) ?? null
  const running = scans.some((s) => s.status === 'running')

  // Poll while a scan is running.
  useEffect(() => {
    if (!running) {
      if (timer.current) window.clearInterval(timer.current)
      return
    }
    timer.current = window.setInterval(async () => {
      try {
        onScansChange((await Api.scans()).scans)
      } catch {
        /* ignore transient poll errors */
      }
    }, 1500)
    return () => {
      if (timer.current) window.clearInterval(timer.current)
    }
  }, [running, onScansChange])

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const res = await Api.createScan({
        months: Number(months) || defaults.months,
        maxMessages: Number(maxMessages) || defaults.maxMessages,
        query: query.trim() || undefined,
      })
      onScansChange((await Api.scans()).scans)
      onSelectScan(res.scan.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />

      <Card title="New scan">
        <p className="mb-4 text-xs text-slate-500">
          Scans your messages, extracts the senders and their sample subjects. Nothing is written to Gmail.
        </p>
        <div className="grid gap-4 md:grid-cols-3">
          <Field label="Months back">
            <Input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} />
          </Field>
          <Field label="Max messages">
            <Input
              type="number"
              min={50}
              max={50000}
              value={maxMessages}
              onChange={(e) => setMaxMessages(e.target.value)}
            />
          </Field>
          <Field label="Extra Gmail query (optional)" help="e.g. -in:chats category:updates">
            <Input value={query} onChange={(e) => setQuery(e.target.value)} />
          </Field>
        </div>
        <div className="mt-4">
          <Button variant="primary" onClick={start} disabled={busy || running}>
            {running ? 'Scan in progress...' : 'Start scan'}
          </Button>
        </div>
      </Card>

      {active && (
        <Card title={`Scan #${active.id}`}>
          <div className="flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <StatusBadge status={active.status} />
            <span>
              {active.messagesFetched} messages processed · {active.sendersFound} senders found
            </span>
            {active.status === 'running' && <Spinner />}
          </div>
          {active.error && <p className="mt-2 text-sm text-red-600">{active.error}</p>}
          {active.status === 'done' && (
            <div className="mt-4">
              <Button variant="primary" onClick={onGoToReview}>
                Review senders and classify
              </Button>
            </div>
          )}
        </Card>
      )}

      <Card title="History">
        <div className="divide-y divide-slate-100">
          {scans.length === 0 && <p className="text-sm text-slate-400">No scans yet.</p>}
          {scans.map((scan) => (
            <div key={scan.id} className="flex items-center justify-between gap-4 py-2">
              <div className="flex items-center gap-3 text-sm">
                <StatusBadge status={scan.status} />
                <span className="text-slate-700">#{scan.id}</span>
                <span className="text-slate-400">
                  last {scan.months}m · {scan.maxMessages} max
                </span>
                <span className="text-slate-400">{scan.startedAt.slice(0, 16).replace('T', ' ')}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge>{scan.sendersFound} senders</Badge>
                <Button
                  variant={scan.id === activeScanId ? 'primary' : 'secondary'}
                  onClick={() => onSelectScan(scan.id)}
                >
                  {scan.status === 'done' ? 'Open' : scan.id === activeScanId ? 'Selected' : 'View'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

function StatusBadge({ status }: { status: Scan['status'] }) {
  if (status === 'done') return <Badge tone="green">done</Badge>
  if (status === 'running') return <Badge tone="amber">running</Badge>
  return <Badge tone="red">error</Badge>
}
