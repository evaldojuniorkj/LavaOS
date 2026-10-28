import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { E2E_PILOT_SLUG } from './tests/e2e/global-setup';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// Mesmos padrões do compose local que tests/helpers/db.ts; o global-setup recusa qualquer banco que não seja lavaos_test local.
const TEST_DB = process.env.TEST_DATABASE_URL ?? 'postgres://lavaos_app:app_local_dev@127.0.0.1:55432/lavaos_test';

export default defineConfig({
  testDir: 'tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1, // todos os testes dividem o mesmo lavaos_test
  forbidOnly: !!process.env.CI,
  reporter: 'list',
  use: { baseURL: BASE, trace: 'retain-on-failure' },
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
    command: 'pnpm build && cp -R .next/static .next/standalone/.next/ && node .next/standalone/server.js',
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
