import type { AiProvider } from '../types.ts'

/**
 * Offline provider for testing the flow without any external service.
 * Classification is handled locally by a keyword heuristic (see classify.ts);
 * this provider only needs to satisfy the interface.
 */
export function mockProvider(): AiProvider {
  return {
    id: 'mock',
    label: 'Mock (offline heuristic)',
    ready: true,
    async generate() {
      return '[]'
    },
    async listModels() {
      return [{ id: 'mock', label: 'mock' }]
    },
  }
}
