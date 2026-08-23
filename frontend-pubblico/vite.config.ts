import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In sviluppo containerizzato (docker-compose.override.yml) il backend non è
// raggiungibile a localhost ma al nome del servizio nella rete Docker interna
// — override via env, default invariato per lo sviluppo locale non containerizzato.
const targetBackend = process.env.VITE_BACKEND_PROXY_TARGET ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    host: true,
    proxy: {
      '/auth': targetBackend,
      '/pubblico': targetBackend,
      '/stagioni': targetBackend,
      '/organismi-sportivi': targetBackend,
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/testUtil/setup.ts'],
    globals: true,
    restoreMocks: true,
  },
});
