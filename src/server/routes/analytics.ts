import { Router } from 'express'
import type { Analytics, DomainStat, LabelStat } from '../../shared/types.ts'
import { all, get } from '../db.ts'
import { requireAccount } from '../http.ts'
import { getScan, getSenders } from '../gmail/scan.ts'

export const analyticsRouter: Router = Router()

const EMPTY: Analytics = {
  scan: null,
  totals: { senders: 0, messages: 0, unread: 0 },
  topSenders: [],
  topDomains: [],
  labels: [],
}

/** Sender analytics for the latest completed scan. */
analyticsRouter.get('/analytics', (_req, res) => {
  const account = requireAccount()
  const latest = get<{ id: number }>(
    "SELECT id FROM scans WHERE account_id = ? AND status = 'done' ORDER BY id DESC LIMIT 1",
    account.id,
  )
  if (!latest) {
    res.json(EMPTY)
    return
  }

  const scan = getScan(latest.id)
  if (!scan) {
    res.json(EMPTY)
    return
  }

  const senders = getSenders(scan.id)
  let messages = 0
  let unread = 0
  const domainMap = new Map<string, DomainStat>()

  for (const sender of senders) {
    messages += sender.messageCount
    unread += sender.unreadCount
    const domain = sender.domain ?? ''
    if (!domain) continue
    const stat = domainMap.get(domain) ?? { domain, senders: 0, messages: 0, unread: 0 }
    stat.senders += 1
    stat.messages += sender.messageCount
    stat.unread += sender.unreadCount
    domainMap.set(domain, stat)
  }

  const topDomains = [...domainMap.values()]
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 15)

  const labelRows = all<{ labels: string }>(
    "SELECT labels FROM classifications WHERE scan_id = ? AND status IN ('accepted','edited')",
    scan.id,
  )
  const labelCounts = new Map<string, number>()
  for (const row of labelRows) {
    try {
      const parsed = JSON.parse(row.labels) as unknown
      if (!Array.isArray(parsed)) continue
      for (const label of parsed) {
        const name = String(label)
        labelCounts.set(name, (labelCounts.get(name) ?? 0) + 1)
      }
    } catch {
      /* ignore malformed rows */
    }
  }
  const labels: LabelStat[] = [...labelCounts.entries()]
    .map(([label, count]) => ({ label, senders: count }))
    .sort((a, b) => b.senders - a.senders)
    .slice(0, 15)

  res.json({
    scan,
    totals: { senders: senders.length, messages, unread },
    topSenders: senders.slice(0, 20),
    topDomains,
    labels,
  } satisfies Analytics)
})
