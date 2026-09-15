import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const h2Target = (env.VITE_H2_SERVICE_URL || 'http://localhost:8765').replace(/\/$/, '')
  const ccsTarget = (env.VITE_CCS_SERVICE_URL || 'http://localhost:8766').replace(/\/$/, '')
  const processTarget = (env.VITE_PROCESS_SERVICE_URL || 'http://localhost:8770').replace(/\/$/, '')

  return {
  plugins: [react()],
  server: {
    proxy: {
      // Keep auth cookies same-origin in local development. Production uses
      // the equivalent /auth-api reverse-proxy route on the app server.
      '/auth-api': {
        target: 'http://127.0.0.1:8001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/auth-api/, '/api'),
      },
      // ── Hydrogen Plant Simulation Service (Tech Simulator) ────────────────
      // Proxies HTTP + WebSocket so the browser never hits the sim service
      // directly (avoids CORS / firewall issues).
      '/h2-proxy': {
        target: h2Target,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/h2-proxy/, ''),
      },
      // ── CCS Simulation Service (Tech Simulator) ───────────────────────────
      '/ccs-proxy': {
        target: ccsTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/ccs-proxy/, ''),
      },
      // ── Process Simulation Service (Process Studio) ───────────────────────
      '/process-proxy': {
        target: processTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/process-proxy/, ''),
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
  },
  }
})
