import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_PORT = process.env.VITE_API_PORT || '5000'
const API_TARGET = `http://127.0.0.1:${API_PORT}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/app/',
  build: {
    /** Standard deploy output: repo root `dist/app/` (see server.js STATIC_APP_DIR). */
    outDir: '../dist/app',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    /** Allow localtunnel / ngrok / Cloudflare tunnel hostnames (not just localhost). */
    allowedHosts: true,
    proxy: {
      '/api': { target: API_TARGET, changeOrigin: true },
      '/uploads': { target: API_TARGET, changeOrigin: true },
    },
  },
})
