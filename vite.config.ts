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
    // WSL + Windows drives (/mnt/c, /mnt/d) don't deliver inotify events
    // reliably; poll so HMR actually sees changes.
    watch: { usePolling: true, interval: 500 },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PORT ?? '8787'}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
})
