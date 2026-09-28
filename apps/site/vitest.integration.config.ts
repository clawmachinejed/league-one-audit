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
    includeTaskLocation: true,
    maxWorkers: 1,
    // Emit failed-test messages before a later timeout can interrupt the final report.
    reporters: ['verbose'],
    testTimeout: 60_000,
  },
});
