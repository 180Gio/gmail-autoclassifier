import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Keep the suite fast and deterministic; tests must not touch the real DB.
    restoreMocks: true,
  },
})
