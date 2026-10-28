import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The SPA is served by FastAPI from `frontend/dist` with base `/` and an SPA fallback.
// In development, `/api` and `/ws` are proxied to the backend (or to `npm run mock`) on :8000.
// `npm run build:static` (VITE_STATIC=1, VITE_BASE=/app/) builds the server-less copy that replays a recorded run.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: process.env.VITE_BASE ?? '/',
  server: {
    port: 5173,
    strictPort: false,
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
      '/ws': { target: 'ws://localhost:8000', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
