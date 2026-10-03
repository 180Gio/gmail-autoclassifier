import { useState } from 'react'
import type { Rule } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Badge, Button, Card, ErrorBanner } from './ui.tsx'

export function RulesPanel({ rules, onChange }: { rules: Rule[]; onChange: (rules: Rule[]) => void }) {
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function remove(id: number) {
    setBusyId(id)
    setError(null)
    try {
      onChange((await Api.deleteRule(id)).rules)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }

  const active = rules.filter((r) => r.status === 'active')

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />
      <Card title={`Active Gmail filters (${active.length})`}>
        {active.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            No filters created yet. Accept some senders and apply them from the Review tab.
          </p>
        )}
        <div className="space-y-3">
          {active.map((rule) => (
            <div
              key={rule.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white/40 p-3 dark:border-white/10 dark:bg-white/5"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-slate-800 dark:text-slate-100">
                  {rule.senderEmail}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                  <span>→</span>
                  {rule.labelNames.map((name) => (
                    <Badge key={name} tone="indigo">
                      {name}
                    </Badge>
                  ))}
                  {rule.actions.archive && <Badge tone="amber">archive</Badge>}
                  {rule.actions.markRead && <Badge tone="amber">mark read</Badge>}
                  {rule.actions.neverSpam && <Badge tone="amber">never spam</Badge>}
                  {rule.backfill && <Badge tone="green">{rule.backfillCount ?? 0} backfilled</Badge>}
                </div>
              </div>
              <Button variant="danger" onClick={() => remove(rule.id)} disabled={busyId === rule.id}>
                Delete filter
              </Button>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-slate-400 dark:text-slate-500">
          Deleting a filter removes the Gmail rule but keeps the label in your account.
        </p>
      </Card>

      {rules.some((r) => r.status !== 'active') && (
        <Card title="Removed filters">
          <div className="space-y-1 text-sm text-slate-400 dark:text-slate-500">
            {rules
              .filter((r) => r.status !== 'active')
              .map((r) => (
                <div key={r.id}>
                  {r.senderEmail} · {r.labelNames.join(', ')} · {r.status}
                </div>
              ))}
          </div>
        </Card>
      )}
    </div>
  )
}
