import { defineConfig, mergeConfig } from 'vite';
import base from './vite.config.ts';
import { mobileAccess } from './capacitor.config.ts';
export default defineConfig(mergeConfig(base, {
  cacheDir: '.nimi/local/vite-mobile',
  plugins: [{ name: 'montage-mobile-entry', transformIndexHtml: { order: 'pre', handler: (html: string) => html.replace('/src/main.tsx', '/src/main.mobile.tsx') } }],
  define: { __NIMI_APP_MOBILE_CONFIG__: JSON.stringify(mobileAccess) },
  build: { outDir: 'dist-mobile' },
}));
