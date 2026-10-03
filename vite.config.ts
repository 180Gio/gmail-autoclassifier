import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The API server runs on PORT (default 8787). In development Vite serves the
// UI on 5173 and proxies /api/* to the API, so the Google OAuth redirect URI
// can stay on the Vite origin (http://localhost:5173/api/auth/google/callback).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.PORT ?? '8787'}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
})
