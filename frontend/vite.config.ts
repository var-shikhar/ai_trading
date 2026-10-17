import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Reads frontend/.env (see .env.example). These values configure the dev
  // server only; without a VITE_ prefix they never reach the browser bundle,
  // and secrets don't belong here anyway (they live in backend/.env).
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.BACKEND_URL || 'http://127.0.0.1:8000'
  const port = Number(env.PORT) || 5173
  // ws: true also forwards the /api/live WebSocket (live prices).
  const proxy = { '/api': { target: backend, ws: true } }

  return {
    plugins: [react(), tailwindcss()],
    server: { port, strictPort: true, proxy },
    preview: { port, proxy },
  }
})
