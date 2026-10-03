import type { AiProviderId } from '../../shared/types.ts'

export interface GenerateRequest {
  /** System instructions. Providers that lack a system role prepend it to the prompt. */
  system?: string
  prompt: string
  /** Ask the provider to return strict JSON when supported. */
  json?: boolean
  temperature?: number
}

export interface ModelOption {
  id: string
  label: string
}

/**
 * Minimal contract every AI backend must implement.
 * Adding a provider means implementing this interface and registering it in
 * `index.ts` — see README "Adding your own AI provider".
 */
export interface AiProvider {
  id: AiProviderId
  label: string
  /** Whether the provider has enough configuration to be used. */
  ready: boolean
  generate(req: GenerateRequest): Promise<string>
  listModels?(): Promise<ModelOption[]>
}
