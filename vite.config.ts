/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Monaco's core editor is ~3.7 MB minified (≈1 MB gzipped); it is bundled locally so the app works offline.
  build: { chunkSizeWarningLimit: 4500 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
