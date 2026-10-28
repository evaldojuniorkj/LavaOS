import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { E2E_PILOT_SLUG } from './tests/e2e/global-setup';
import { assertTestDb, testUrls } from './tests/helpers/test-db';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// Mesma fonte do global-setup (que zera e popula): servidor e fixtures nunca apontam para bancos diferentes.
const TEST_DB = testUrls.app;
assertTestDb(TEST_DB);
// `pnpm verify:foundation` acabou de rodar `pnpm build` e reaproveita; `pnpm test:e2e` sozinho sempre compila de novo.
const BUILD = process.env.E2E_REUSE_BUILD === '1' ? '' : 'pnpm build && ';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1, // todos os testes dividem o mesmo lavaos_test
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  // traces/vídeos gravam o que é digitado (senhas e PINs da execução): só localmente, nunca no CI
  use: { baseURL: BASE, trace: process.env.CI ? 'off' : 'retain-on-failure', screenshot: 'off', video: 'off' },
  projects: [
    // IP distinto por projeto: cada um tem sua própria cota de tentativas PIN por origem
    { name: 'desktop', use: { ...devices['Desktop Chrome'], extraHTTPHeaders: { 'x-real-ip': '10.0.0.1' } } },
    {
      name: 'mobile',
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-real-ip': '10.0.0.2' } },
    },
  ],
  // Servidor de produção (build standalone, como na VPS): sem HMR/compilação sob demanda do `next dev`.
  // `next start` não serve `output: standalone`; os estáticos são copiados como no deploy.
  webServer: {
    command: `${BUILD}cp -R .next/static .next/standalone/.next/ && node .next/standalone/server.js`,
    url: `${BASE}/api/auth/get-session`,
    reuseExistingServer: false,
    timeout: 300_000,
    // logs esperados (negações registradas, senha inválida) ficam fora da saída; DEBUG=pw:webserver mostra tudo
    stdout: 'ignore',
    stderr: 'ignore',
    env: {
      PORT: String(PORT),
      HOSTNAME: '127.0.0.1',
      LAVAOS_MODE: 'test',
      DATABASE_URL: TEST_DB,
      MIGRATION_DATABASE_URL: TEST_DB,
      TEST_DATABASE_URL: TEST_DB,
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64'), // efêmero por execução
      BETTER_AUTH_URL: BASE,
      LAVAOS_PILOT_SLUG: E2E_PILOT_SLUG,
    },
  },
});
