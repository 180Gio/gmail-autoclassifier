import { useCallback, useEffect, useState } from 'react'
import type { GmailFilter, Rule } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Badge, Button, Card, ErrorBanner, Spinner } from './ui.tsx'

export function RulesPanel({ rules, onChange }: { rules: Rule[]; onChange: (rules: Rule[]) => void }) {
  const [filters, setFilters] = useState<GmailFilter[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const loadFilters = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setFilters((await Api.gmailFilters()).filters)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadFilters()
  }, [loadFilters])

  async function removeFilter(id: string) {
    setBusyId(id)
    setError(null)
    try {
      const res = await Api.deleteGmailFilter(id)
      setFilters(res.filters)
      onChange((await Api.rules()).rules)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const appCreated = filters.filter((f) => f.createdByApp).length
  const removed = rules.filter((r) => r.status !== 'active')

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />

      <Card
        title={`Filters in Gmail (${filters.length})`}
        actions={
          <Button onClick={loadFilters} disabled={loading}>
            {loading ? <Spinner /> : null} Refresh from Gmail
          </Button>
        }
      >
        <p className="mb-4 text-xs text-slate-500 dark:text-slate-400">
          Every filter configured in your Gmail account, including ones created outside this app
          ({appCreated} of {filters.length} were created here).
        </p>

        {filters.length === 0 && !loading && (
          <p className="text-sm text-slate-400 dark:text-slate-500">No filters found in Gmail.</p>
        )}

        <div className="space-y-3">
          {filters.map((filter) => (
            <div
              key={filter.id}
              className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-slate-700 dark:text-slate-200">
                    {describeCriteria(filter)}
                  </span>
                  {filter.createdByApp && <Badge tone="indigo">created by app</Badge>}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>→</span>
                  {filter.addLabels.map((name) => (
                    <Badge key={`add-${name}`} tone="green">
                      + {name}
                    </Badge>
                  ))}
                  {filter.removeLabels.map((name) => (
                    <Badge key={`rm-${name}`} tone="amber">
                      − {name}
                    </Badge>
                  ))}
                  {filter.forward && <Badge tone="slate">forward → {filter.forward}</Badge>}
                  {filter.addLabels.length === 0 &&
                    filter.removeLabels.length === 0 &&
                    !filter.forward && <span className="italic">no action</span>}
                </div>
              </div>
              <Button
                variant="danger"
                onClick={() => removeFilter(filter.id)}
                disabled={busyId === filter.id}
              >
                Delete
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Deleting a filter removes the Gmail rule but keeps the labels themselves.
        </p>
      </Card>

      <Card title={`Created by this app (${rules.filter((r) => r.status === 'active').length} active)`}>
        {rules.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            Nothing yet. Accept some senders and apply them from the Review tab.
          </p>
        )}
        <div className="space-y-2 text-sm">
          {rules.map((rule) => (
            <div key={rule.id} className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
              <span className="text-slate-800 dark:text-slate-100">
                {rule.senderEmail ?? rule.query}
              </span>
              {rule.labelNames.map((name) => (
                <Badge key={name} tone="indigo">
                  {name}
                </Badge>
              ))}
              {rule.backfill && <Badge tone="green">{rule.backfillCount ?? 0} backfilled</Badge>}
              <Badge tone={rule.status === 'active' ? 'green' : 'red'}>{rule.status}</Badge>
            </div>
          ))}
        </div>
        {removed.length > 0 && (
          <p className="mt-3 text-xs text-slate-400 dark:text-slate-500">
            {removed.length} filter(s) removed from Gmail.
          </p>
        )}
      </Card>
    </div>
  )
}

function describeCriteria(filter: GmailFilter): string {
  const parts: string[] = []
  if (filter.from) parts.push(`from: ${filter.from}`)
  if (filter.to) parts.push(`to: ${filter.to}`)
  if (filter.subject) parts.push(`subject: ${filter.subject}`)
  if (filter.query) parts.push(`query: ${filter.query}`)
  if (filter.negatedQuery) parts.push(`without: ${filter.negatedQuery}`)
  if (filter.hasAttachment) parts.push('has attachment')
  return parts.length > 0 ? parts.join(' · ') : '(all mail)'
}
