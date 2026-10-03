import { useCallback, useEffect, useState } from 'react'
import type { Label, Rule, Scan, SettingView, StatusResponse } from '../shared/types.ts'
import { Api } from './api.ts'
import { LabelsPanel } from './components/LabelsPanel.tsx'
import { ReviewPanel } from './components/ReviewPanel.tsx'
import { RulesPanel } from './components/RulesPanel.tsx'
import { ScanPanel } from './components/ScanPanel.tsx'
import { SettingsPanel } from './components/SettingsPanel.tsx'
import { Badge, Button, Card, ErrorBanner, SuccessBanner } from './components/ui.tsx'

type Tab = 'connect' | 'labels' | 'scan' | 'review' | 'rules' | 'settings'

const TABS: Array<{ id: Tab; label: string; needsAccount: boolean }> = [
  { id: 'connect', label: 'Overview', needsAccount: false },
  { id: 'labels', label: 'Labels', needsAccount: true },
  { id: 'scan', label: 'Scan', needsAccount: true },
  { id: 'review', label: 'Review', needsAccount: true },
  { id: 'rules', label: 'Rules', needsAccount: true },
  { id: 'settings', label: 'Settings', needsAccount: false },
]

function str(settings: SettingView[], key: string, fallback = ''): string {
  return settings.find((s) => s.key === key)?.value ?? fallback
}

function bool(settings: SettingView[], key: string, fallback = false): boolean {
  const value = settings.find((s) => s.key === key)?.value
  return value === null || value === undefined ? fallback : value === 'true'
}

export function App() {
  const [tab, setTab] = useState<Tab>('connect')
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [settings, setSettings] = useState<SettingView[]>([])
  const [labels, setLabels] = useState<Label[]>([])
  const [scans, setScans] = useState<Scan[]>([])
  const [rules, setRules] = useState<Rule[]>([])
  const [activeScanId, setActiveScanId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    try {
      const s = await Api.status()
      setStatus(s)
      return s
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      return null
    }
  }, [])

  const refreshAccountData = useCallback(async () => {
    try {
      const [labelsRes, scansRes, rulesRes] = await Promise.all([
        Api.labels(),
        Api.scans(),
        Api.rules(),
      ])
      setLabels(labelsRes.labels)
      setScans(scansRes.scans)
      setRules(rulesRes.rules)
      setActiveScanId((current) => {
        if (current && scansRes.scans.some((s) => s.id === current)) return current
        const latestDone = scansRes.scans.find((s) => s.status === 'done')
        return latestDone?.id ?? scansRes.scans[0]?.id ?? null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search)
      const connected = params.get('connected')
      const authError = params.get('authError')
      if (connected) setNotice(`Connected as ${connected}.`)
      if (authError) setError(`Google authorization failed: ${authError}`)
      if (connected || authError) window.history.replaceState({}, '', window.location.pathname)

      const s = await refreshStatus()
      const settingsRes = await Api.settings().catch(() => null)
      if (settingsRes) setSettings(settingsRes.settings)
      if (s?.connected) await refreshAccountData()
    })()
  }, [refreshStatus, refreshAccountData])

  const connect = () => {
    window.location.href = Api.connectUrl
  }

  const disconnect = async () => {
    setError(null)
    try {
      await Api.disconnect()
      setStatus(await Api.status())
      setLabels([])
      setScans([])
      setRules([])
      setActiveScanId(null)
      setTab('connect')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const connected = status?.connected ?? false
  const scanDefaults = {
    months: Number(str(settings, 'scan.months', '6')) || 6,
    maxMessages: Number(str(settings, 'scan.maxMessages', '2000')) || 2000,
  }
  const filterDefaults = {
    archive: bool(settings, 'filters.archive'),
    markRead: bool(settings, 'filters.markRead'),
    neverSpam: bool(settings, 'filters.neverSpam', true),
    applyToExisting: bool(settings, 'filters.applyToExisting'),
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Gmail AutoClassifier</h1>
            <p className="text-xs text-slate-500">
              AI-assisted labels and Gmail filters, always with a manual review step.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {status && (
              <>
                {connected ? (
                  <Badge tone="green">{status.account?.email}</Badge>
                ) : (
                  <Badge tone="amber">not connected</Badge>
                )}
                <Badge tone={status.providerReady ? 'indigo' : 'red'}>
                  AI: {status.providerLabel}
                </Badge>
              </>
            )}
            {connected && (
              <Button variant="ghost" onClick={disconnect}>
                Disconnect
              </Button>
            )}
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4">
          {TABS.map((item) => {
            const disabled = item.needsAccount && !connected
            return (
              <button
                key={item.id}
                onClick={() => !disabled && setTab(item.id)}
                disabled={disabled}
                className={`whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition ${
                  tab === item.id
                    ? 'border-indigo-600 text-indigo-700'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-6 py-6">
        <ErrorBanner error={error} />
        <SuccessBanner message={notice} />

        {tab === 'connect' && (
          <ConnectPanel
            status={status}
            labelsCount={labels.length}
            rulesCount={rules.filter((r) => r.status === 'active').length}
            onConnect={connect}
            onGoSettings={() => setTab('settings')}
          />
        )}
        {tab === 'labels' && connected && <LabelsPanel labels={labels} onChange={setLabels} />}
        {tab === 'scan' && connected && (
          <ScanPanel
            scans={scans}
            activeScanId={activeScanId}
            defaults={scanDefaults}
            onScansChange={setScans}
            onSelectScan={setActiveScanId}
            onGoToReview={() => setTab('review')}
          />
        )}
        {tab === 'review' && connected && (
          <ReviewPanel
            scanId={activeScanId}
            labels={labels}
            filterDefaults={filterDefaults}
            onGoToRules={() => setTab('rules')}
          />
        )}
        {tab === 'rules' && connected && <RulesPanel rules={rules} onChange={setRules} />}
        {tab === 'settings' && <SettingsPanel settings={settings} onSaved={setSettings} />}
      </main>

      <footer className="mx-auto max-w-6xl px-6 pb-10 text-xs text-slate-400">
        Runs locally. Secrets and tokens are stored encrypted in <code>data/app.sqlite</code>.
      </footer>
    </div>
  )
}

function ConnectPanel({
  status,
  labelsCount,
  rulesCount,
  onConnect,
  onGoSettings,
}: {
  status: StatusResponse | null
  labelsCount: number
  rulesCount: number
  onConnect: () => void
  onGoSettings: () => void
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Card title="1 · Connect Gmail">
        <p className="text-sm text-slate-600">
          Authorize read/modify access, label management and Gmail filter creation. This app never sends
          email on your behalf.
        </p>
        <div className="mt-4 space-y-3">
          {status?.connected ? (
            <>
              <Badge tone="green">Connected as {status.account?.email}</Badge>
              <div className="flex gap-2 text-sm text-slate-500">
                <span>{labelsCount} labels</span>
                <span>·</span>
                <span>{rulesCount} active filters</span>
              </div>
            </>
          ) : status?.googleConfigured ? (
            <Button variant="primary" onClick={onConnect}>
              Connect Gmail account
            </Button>
          ) : (
            <>
              <p className="text-sm text-amber-600">
                Google OAuth is not configured yet. Add your Client ID and Secret first.
              </p>
              <Button variant="primary" onClick={onGoSettings}>
                Open Settings
              </Button>
            </>
          )}
        </div>
      </Card>

      <Card title="How it works">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-600">
          <li>Create labels and describe what belongs in each one.</li>
          <li>Run a scan to collect the senders in your mailbox.</li>
          <li>The AI suggests a label for each sender.</li>
          <li>Review and adjust, then apply to create Gmail filters.</li>
        </ol>
        <p className="mt-4 text-xs text-slate-400">
          The selected AI provider is <strong>{status?.providerLabel ?? '...'}</strong>. Configure or
          change it in Settings.
        </p>
      </Card>
    </div>
  )
}
