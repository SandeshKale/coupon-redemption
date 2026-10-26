import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: '24M Coupons',
        short_name: '24M',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#05603A',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // App shell only: API responses are never cached (money must always be live).
        globPatterns: ['**/*.{js,css,html,svg,json}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/auth\/v1/, /^\/rest\/v1/, /^\/functions\/v1/],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@supabase/auth-js')) return 'auth';
          if (id.includes('@zxing')) return 'zxing';
          if (id.includes('@tanstack')) return 'query';
          if (id.includes('@sentry')) return 'sentry';
          return undefined;
        },
      },
    },
  },
  server: { port: 5173 },
});
