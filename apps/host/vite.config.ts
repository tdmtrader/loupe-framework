// Vite shell on 5173; fabrial files, config, and app proxying live in
// server.ts (127.0.0.1:6170) — the shell reaches them same-origin so the
// wsClient's relative base works unchanged in dev.
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const HOST_SERVER = process.env['LOUPE_HOST_SERVER'] ?? `http://127.0.0.1:${process.env['LOUPE_PORT'] ?? 6170}`;
const UI_PORT = Number(process.env['LOUPE_UI_PORT'] ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: UI_PORT,
    strictPort: true,
    proxy: {
      '/fabrials': HOST_SERVER,
      '/config': HOST_SERVER,
      '/apps': { target: HOST_SERVER, ws: true },
    },
  },
});
