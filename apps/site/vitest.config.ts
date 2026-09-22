import { fileURLToPath } from 'node:url';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    server: { deps: { inline: ['@neondatabase/auth'] } },
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
});
