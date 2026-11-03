import { defineConfig } from 'vite'

const server = { host: '127.0.0.1', port: 5173, strictPort: true }

export default defineConfig({
  root: 'site',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1000 },
  server,
  preview: server,
})
