import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('..', import.meta.url)),
    'server-only': fileURLToPath(new URL('./server-only-stub.ts', import.meta.url)) } },
  test: { environment: 'node', fileParallelism: false, maxWorkers: 1,
    globalSetup: ['./integration/collection-capacity.global-setup.ts'],
    include: ['integration/collection-capacity.capacity-case.ts'], hookTimeout: 180_000, testTimeout: 720_000 },
});
