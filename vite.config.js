import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Service worker « auto-destructeur » : il se désinstalle et vide les
      // caches obsolètes au prochain chargement. Nécessaire pour débloquer les
      // navigateurs coincés sur une ancienne version (le cache PWA ne se
      // rafraîchissait pas et masquait les mises à jour).
      selfDestroying: true,
      includeAssets: ['logo.png'],
      manifest: {
        name: 'TravelO — Itinéraires de voyage sur mesure',
        short_name: 'TravelO',
        description:
          'Générateur d\'itinéraires de voyage ultra-détaillés, comme un tour-opérateur.',
        lang: 'fr',
        theme_color: '#2573eb',
        background_color: '#f8fafc',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: '/logo.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any',
          },
          {
            src: '/logo.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      workbox: {
        // Limites + stratégies de cache
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [
          /^\/auth\//,
          /^\/api\//,
          /^\/functions\//,
        ],
        runtimeCaching: [
          {
            // Tiles OpenStreetMap : cache long pour gagner du temps
            urlPattern: /^https:\/\/[a-z]\.tile\.openstreetmap\.org\/.*/i,
            handler: 'CacheFirst',
            options: {
              // Nouveau nom de cache → on repart de zéro et on invalide les
              // éventuelles tuiles cassées mises en cache précédemment.
              cacheName: 'osm-tiles-v2',
              cacheableResponse: { statuses: [0, 200] },
              expiration: {
                maxEntries: 500,
                maxAgeSeconds: 30 * 24 * 60 * 60, // 30 jours
              },
            },
          },
          {
            // Photos Pexels CDN
            urlPattern: /^https:\/\/images\.pexels\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'pexels-images',
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 14 * 24 * 60 * 60,
              },
            },
          },
          {
            // API Supabase : ne PAS mettre en cache (auth + données dynamiques)
            urlPattern: /^https:\/\/[a-z0-9]+\.supabase\.co\/.*/i,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
});
