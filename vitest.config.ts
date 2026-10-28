import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    fileParallelism: false, // integração compartilha o banco de testes
    alias: { 'server-only': fileURLToPath(new URL('./tests/helpers/empty.ts', import.meta.url)) },
    // unit primeiro, depois integration (grupos em sequência); `--project` roda um só
    projects: [
      { extends: true, test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'integration', include: ['tests/integration/**/*.test.ts'], sequence: { groupOrder: 1 } } },
    ],
  },
});
