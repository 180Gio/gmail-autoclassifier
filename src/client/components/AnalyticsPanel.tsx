import { useEffect, useState } from 'react'
import type { Analytics } from '../../shared/types.ts'
import { Api } from '../api.ts'
import { Badge, Card, ErrorBanner, Spinner } from './ui.tsx'

export function AnalyticsPanel() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        setData(await Api.analytics())
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  if (loading) return <Spinner />
  if (!data) return <ErrorBanner error={error} />
  if (!data.scan) {
    return (
      <Card title="Analytics">
        <p className="text-sm text-slate-400 dark:text-slate-500">
          Run a scan first to see sender analytics.
        </p>
      </Card>
    )
  }

  const maxDomain = Math.max(1, ...data.topDomains.map((d) => d.messages))
  const maxLabel = Math.max(1, ...data.labels.map((l) => l.senders))

  return (
    <div className="space-y-5">
      <ErrorBanner error={error} />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Senders" value={data.totals.senders} />
        <StatCard label="Messages" value={data.totals.messages} />
        <StatCard label="Unread" value={data.totals.unread} />
      </div>

      <Card title={`Latest scan #${data.scan.id}`}>
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Badge tone={data.scan.mode === 'incremental' ? 'indigo' : 'slate'}>{data.scan.mode}</Badge>
          <span>{data.scan.messagesFetched} messages processed</span>
          <span>·</span>
          <span>{data.scan.startedAt.slice(0, 10)}</span>
          {data.scan.messagesSkipped > 0 && (
            <Badge tone="amber">{data.scan.messagesSkipped} skipped</Badge>
          )}
        </div>
      </Card>

      <Card title="Top senders by volume">
        {data.topSenders.length === 0 && (
          <p className="text-sm text-slate-400 dark:text-slate-500">No senders in this scan.</p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                <th className="py-2 pr-3">Sender</th>
                <th className="py-2 pr-3">Messages</th>
                <th className="py-2 pr-3">Unread</th>
                <th className="py-2">Last seen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/70 dark:divide-white/10">
              {data.topSenders.map((sender) => (
                <tr key={sender.email}>
                  <td className="py-2 pr-3">
                    <div className="font-medium text-slate-800 dark:text-slate-100">
                      {sender.displayName ?? sender.email}
                    </div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">{sender.email}</div>
                  </td>
                  <td className="py-2 pr-3 text-slate-700 dark:text-slate-200">
                    {sender.messageCount}
                  </td>
                  <td className="py-2 pr-3">
                    {sender.unreadCount > 0 ? (
                      <Badge tone="amber">{sender.unreadCount}</Badge>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="py-2 text-xs text-slate-400 dark:text-slate-500">
                    {sender.lastSeen ? sender.lastSeen.slice(0, 10) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Top domains">
          {data.topDomains.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500">No domain data.</p>
          )}
          <div className="space-y-3">
            {data.topDomains.map((domain) => (
              <div key={domain.domain} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate font-mono text-slate-700 dark:text-slate-200">
                    {domain.domain}
                  </span>
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">
                    {domain.messages} msg · {domain.senders} senders
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200/70 dark:bg-white/10">
                  <div
                    className="h-2 rounded-full bg-indigo-500"
                    style={{ width: `${(domain.messages / maxDomain) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Accepted senders per label">
          {data.labels.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500">
              Accept some suggestions to see the label distribution.
            </p>
          )}
          <div className="space-y-3">
            {data.labels.map((label) => (
              <div key={label.label} className="space-y-1">
                <div className="flex items-baseline justify-between gap-3 text-xs">
                  <span className="truncate text-slate-700 dark:text-slate-200">{label.label}</span>
                  <span className="shrink-0 text-slate-400 dark:text-slate-500">
                    {label.senders} senders
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-200/70 dark:bg-white/10">
                  <div
                    className="h-2 rounded-full bg-emerald-500"
                    style={{ width: `${(label.senders / maxLabel) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="glass p-5">
      <div className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-slate-900 dark:text-white">
        {value.toLocaleString()}
      </div>
    </div>
  )
}
