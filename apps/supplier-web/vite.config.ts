import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  validateProductionApiOrigin(mode, loadEnv(mode, process.cwd(), '').VITE_API_ORIGIN);
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        registerType: 'prompt',
        injectManifest: {
          globPatterns: ['**/*.{js,css,png,svg,ico,webp,woff2}', 'offline.html'],
          // Large route-level Canvas imagery stays network-on-demand with its lazy chunk.
          globIgnores: ['assets/*.png'],
        },
        manifest: {
          id: '/',
          name: 'TMMIN Supplier Henkaten',
          short_name: 'Henkaten',
          description: 'Portal operasional Henkaten untuk supplier TMMIN.',
          lang: 'id',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          orientation: 'any',
          background_color: '#f7f8fa',
          theme_color: '#e34d19',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
            {
              src: '/icons/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
      }),
    ],
    server: { port: 5173 },
    preview: { port: 4173 },
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
