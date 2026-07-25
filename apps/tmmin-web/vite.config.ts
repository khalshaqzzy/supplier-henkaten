import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  validateProductionApiOrigin(mode, loadEnv(mode, process.cwd(), '').VITE_API_ORIGIN);
  return {
    plugins: [react(), tailwindcss()],
    server: { port: 5174 },
    preview: { port: 4174 },
  };
});

function validateProductionApiOrigin(mode: string, value: string | undefined) {
  if (mode !== 'production') return;
  if (!value) throw new Error('VITE_API_ORIGIN wajib ditetapkan untuk production build.');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== '/'
  ) {
    throw new Error(
      'VITE_API_ORIGIN harus berupa HTTP(S) origin tanpa credential, path, query, atau hash.',
    );
  }
}
