import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { pagePrerender } from './scripts/vite/pagePrerender';

const root = import.meta.dirname;

export default defineConfig({
  plugins: [pagePrerender()],
  build: {
    target: 'es2022',
    rollupOptions: {
      input: {
        main: resolve(root, 'index.html'),
        page: resolve(root, 'page/index.html'),
      },
      output: {
        // Keep three.js in a chunk of its own. Left to itself Rollup folds any module shared by the
        // world and flight chunks into it, and then its hash (and every visitor's cached copy of
        // half a megabyte) changes whenever that small module does.
        manualChunks: (id) => (id.includes('/node_modules/three/') ? 'three' : undefined),
      },
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
