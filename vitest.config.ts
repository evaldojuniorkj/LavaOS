import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    fileParallelism: false, // integração compartilha o banco de testes
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    alias: { 'server-only': fileURLToPath(new URL('./tests/helpers/empty.ts', import.meta.url)) },
  },
});
