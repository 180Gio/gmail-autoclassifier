import type { AiProviderId } from '../../shared/types.ts'
import { getAiProviderId } from '../settings.ts'
import { opencodeProvider } from './providers/opencode.ts'
import { opencodeGoProvider } from './providers/opencode-go.ts'
import { openaiProvider } from './providers/openai.ts'
import { mockProvider } from './providers/mock.ts'
import type { AiProvider } from './types.ts'

export type { AiProvider, GenerateRequest, ModelOption } from './types.ts'

/** Instantiate the currently selected provider (reads settings at call time). */
export function getProvider(id: AiProviderId = getAiProviderId()): AiProvider {
  switch (id) {
    case 'opencode':
      return opencodeProvider()
    case 'opencode-go':
      return opencodeGoProvider()
    case 'openai':
      return openaiProvider()
    case 'mock':
      return mockProvider()
    default:
      return opencodeProvider()
  }
}
