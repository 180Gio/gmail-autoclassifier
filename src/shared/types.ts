/**
 * Shared types between the API server and the web client.
 */

export type AiProviderId = 'opencode' | 'openai' | 'mock'

export type LabelKind = 'user' | 'system'

export interface Account {
  id: number
  email: string
  createdAt: string
}

export interface Label {
  id: number
  accountId: number
  gmailId: string | null
  name: string
  description: string
  kind: LabelKind
  createdByApp: boolean
  color: string | null
}

export interface Scan {
  id: number
  accountId: number
  status: 'running' | 'done' | 'error'
  query: string | null
  months: number
  maxMessages: number
  messagesFetched: number
  sendersFound: number
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export interface Sender {
  id: number
  scanId: number
  email: string
  displayName: string | null
  domain: string | null
  messageCount: number
  unreadCount: number
  sampleSubjects: string[]
  lastSeen: string | null
}

export type ClassificationStatus = 'suggested' | 'accepted' | 'rejected' | 'edited'

export interface Classification {
  id: number
  scanId: number
  senderEmail: string
  labels: string[]
  confidence: number | null
  rationale: string | null
  status: ClassificationStatus
  source: 'ai' | 'manual'
  model: string | null
  /** Sender stats joined in for the review UI. */
  sender?: Sender
}

export interface RuleActions {
  archive?: boolean
  markRead?: boolean
  neverSpam?: boolean
  star?: boolean
  important?: boolean
}

export interface Rule {
  id: number
  accountId: number
  gmailFilterId: string | null
  labelNames: string[]
  senderEmail: string | null
  domain: string | null
  query: string | null
  actions: RuleActions
  backfill: boolean
  backfillCount: number | null
  status: 'active' | 'deleted' | 'error'
  error: string | null
  createdAt: string
}

export type SettingType = 'string' | 'secret' | 'number' | 'boolean' | 'select'

export interface SettingDefinition {
  key: string
  group: 'ai' | 'google' | 'scan' | 'filters'
  type: SettingType
  label: string
  help?: string
  options?: string[]
  default?: string
}

/** A setting value as exposed to the client. Secrets are never sent in clear. */
export interface SettingView {
  key: string
  group: SettingDefinition['group']
  type: SettingType
  label: string
  help?: string
  options?: string[]
  value: string | null
  /** For type === 'secret': whether a value is stored. */
  hasValue: boolean
}

export interface StatusResponse {
  connected: boolean
  account: Account | null
  providerId: AiProviderId
  providerLabel: string
  providerReady: boolean
  googleConfigured: boolean
  counts: {
    labels: number
    scans: number
    rules: number
  }
}
