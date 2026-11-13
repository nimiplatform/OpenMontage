import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  cacheDir: '.nimi/local/vite-desktop',
  server:{watch:{ignored:['**/.nimi/local/**','**/android/**','**/dist-web/**','**/dist-mobile/**','**/dist-electron/**']}},
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
  },
});
