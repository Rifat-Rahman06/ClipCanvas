import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Keep in sync with `minimum_chrome_version` in chrome/manifest.json.
    target: 'chrome116',
    sourcemap: false,
    // The panel and popup are independent always-loaded entries (React +
    // Markdown renderer); a few ~520 kB chunks are expected.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        panel: resolve(root, 'index.html'),
        popup: resolve(root, 'popup.html'),
      },
    },
  },
});
