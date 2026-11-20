import { defineConfig, loadEnv, mergeConfig } from 'vite';
import { nimiWebViteConfig } from '@nimiplatform/app-tools/web';
import base from './vite.config.ts';
export default defineConfig(({ command, mode }) => mergeConfig(mergeConfig(base, {
  cacheDir: '.nimi/local/vite-web',
  plugins: [{ name: 'montage-web-entry', transformIndexHtml: { order: 'pre', handler: (html: string) => html.replace('/src/main.tsx', '/src/main.web.tsx') } }],
  build: { outDir: 'dist-web', emptyOutDir: true },
}), nimiWebViteConfig({ root: import.meta.dirname, env: { ...loadEnv(mode, import.meta.dirname, ''), ...process.env }, serve: command === 'serve', release: mode === 'web-release' })));
