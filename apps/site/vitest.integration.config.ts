import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
      'server-only': fileURLToPath(new URL('./integration/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    fileParallelism: false,
    globalSetup: ['./integration/global-setup.ts'],
    hookTimeout: 120_000,
    include: ['integration/**/*.integration-case.ts'],
    maxWorkers: 1,
    testTimeout: 60_000,
  },
});
