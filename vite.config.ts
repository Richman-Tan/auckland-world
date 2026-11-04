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
    },
  },
  worker: { format: 'es' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
