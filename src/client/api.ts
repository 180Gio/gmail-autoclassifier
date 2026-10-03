import type {
  Classification,
  ClassificationStatus,
  Label,
  Rule,
  Scan,
  Sender,
  SettingView,
  StatusResponse,
} from '../shared/types.ts'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const text = await res.text()
  const data = text ? (JSON.parse(text) as unknown) : {}
  if (!res.ok) {
    const message = (data as { error?: string }).error ?? res.statusText
    throw new Error(message)
  }
  return data as T
}

export const Api = {
  status: () => request<StatusResponse>('/api/status'),

  settings: () => request<{ settings: SettingView[] }>('/api/settings'),
  saveSettings: (values: Record<string, unknown>) =>
    request<{ settings: SettingView[] }>('/api/settings', {
      method: 'PUT',
      body: JSON.stringify(values),
    }),
  testAi: () =>
    request<{ ok: boolean; provider: string; text?: string; error?: string }>(
      '/api/settings/test-ai',
      { method: 'POST' },
    ),
  models: () => request<{ models: Array<{ id: string; label: string }> }>('/api/settings/models'),

  connectUrl: '/api/auth/google',
  disconnect: () => request<{ ok: true }>('/api/auth/disconnect', { method: 'POST' }),

  labels: () => request<{ labels: Label[] }>('/api/labels'),
  syncLabels: () => request<{ labels: Label[] }>('/api/labels/sync', { method: 'POST' }),
  createLabel: (name: string, description: string) =>
    request<{ label: Label }>('/api/labels', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  updateLabel: (id: number, patch: { name?: string; description?: string }) =>
    request<{ label: Label }>(`/api/labels/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),

  scans: () => request<{ scans: Scan[] }>('/api/scans'),
  createScan: (input: { months: number; maxMessages: number; query?: string }) =>
    request<{ scan: Scan }>('/api/scans', { method: 'POST', body: JSON.stringify(input) }),
  scan: (id: number) => request<{ scan: Scan }>(`/api/scans/${id}`),
  senders: (id: number) => request<{ senders: Sender[] }>(`/api/scans/${id}/senders`),
  classifications: (id: number) =>
    request<{ classifications: Classification[] }>(`/api/scans/${id}/classifications`),
  classify: (id: number) =>
    request<{ classifications: Classification[] }>(`/api/scans/${id}/classify`, { method: 'POST' }),
  updateClassification: (id: number, patch: { labels?: string[]; status?: ClassificationStatus }) =>
    request<{ classification: Classification }>(`/api/classifications/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
  mark: (scanId: number, status: ClassificationStatus, ids?: number[]) =>
    request<{ classifications: Classification[] }>(`/api/scans/${scanId}/mark`, {
      method: 'POST',
      body: JSON.stringify({ status, ids }),
    }),
  apply: (
    scanId: number,
    options: { archive: boolean; markRead: boolean; neverSpam: boolean; applyToExisting: boolean },
  ) =>
    request<{ result: { rulesCreated: number; messagesBackfilled: number; errors: Array<{ sender: string; message: string }> }; rules: Rule[] }>(
      `/api/scans/${scanId}/apply`,
      { method: 'POST', body: JSON.stringify(options) },
    ),

  rules: () => request<{ rules: Rule[] }>('/api/rules'),
  deleteRule: (id: number) =>
    request<{ rules: Rule[] }>(`/api/rules/${id}`, { method: 'DELETE' }),
}
