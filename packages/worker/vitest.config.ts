import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    timeout: 30000, // DraftKings API can be slow
    watch: false, // Don't watch by default
  },
});