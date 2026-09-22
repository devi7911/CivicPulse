import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Installable app + offline support + push notifications, from our own service worker (src/sw.ts).
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: false,
      manifest: false, // public/manifest.webmanifest is used as is
      injectManifest: { globPatterns: ['**/*.{js,css,html,svg,woff2,webmanifest}'], maximumFileSizeToCacheInBytes: 3 * 1024 * 1024 },
      devOptions: { enabled: false },
    }),
  ],
  server: { port: 5180, strictPort: true },
});
