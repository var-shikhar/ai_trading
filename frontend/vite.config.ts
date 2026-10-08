import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Forward API calls to the FastAPI backend in dev.
    proxy: {
      // ws: true also forwards the /api/live WebSocket (live prices).
      '/api': { target: 'http://127.0.0.1:8000', ws: true },
    },
  },
})
