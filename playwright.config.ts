import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
import { E2E_ONBOARDING, E2E_PILOT_SLUG } from './tests/e2e/global-setup';
import { assertTestDb, testUrls } from './tests/helpers/test-db';

const PORT = 3100;
const BASE = `http://localhost:${PORT}`;
// Mesma fonte do global-setup (que zera e popula): servidor e fixtures nunca apontam para bancos diferentes.
const TEST_DB = testUrls.app;
assertTestDb(TEST_DB);
// `pnpm verify:operacao` acabou de rodar `pnpm build` e reaproveita; `pnpm test:e2e` sozinho sempre compila de novo.
const LAVADOR = /operacao-lavador\.spec\.ts$/;
const PAINEL = /painel\.spec\.ts$/;
const ONBOARDING = /operacao-primeiro-acesso\.spec\.ts$/;
const ONBOARDING_BASE = `http://localhost:${E2E_ONBOARDING.port}`;
const BUILD = process.env.E2E_REUSE_BUILD === '1' ? '' : 'pnpm build && ';

// Servidor de produção (build standalone, como na VPS): sem HMR/compilação sob demanda do `next dev`.
// `next start` não serve `output: standalone`; os estáticos e o public/ (ícones do PWA) são copiados como no deploy.
const SERVIDOR = {
  reuseExistingServer: false,
  timeout: 300_000,
  // logs esperados (negações registradas, senha inválida) ficam fora da saída; DEBUG=pw:webserver mostra tudo
  stdout: 'ignore' as const,
  stderr: 'ignore' as const,
  env: {
    HOSTNAME: '127.0.0.1',
    LAVAOS_MODE: 'test',
    DATABASE_URL: TEST_DB,
    MIGRATION_DATABASE_URL: TEST_DB,
    TEST_DATABASE_URL: TEST_DB,
    BETTER_AUTH_SECRET: randomBytes(32).toString('base64'), // efêmero por execução
    LAVAOS_PILOT_SLUG: E2E_PILOT_SLUG,
  },
};

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
    { name: 'desktop', testIgnore: [LAVADOR, ONBOARDING], use: { ...devices['Desktop Chrome'], extraHTTPHeaders: { 'x-real-ip': '10.0.0.1' } } },
    {
      name: 'mobile',
      testIgnore: [LAVADOR, ONBOARDING],
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, extraHTTPHeaders: { 'x-real-ip': '10.0.0.2' } },
    },
    // assistente de primeiro acesso: servidor próprio com LAVAOS_SETUP_TOKEN e schema sem lava jato
    { name: 'onboarding-desktop', testMatch: ONBOARDING, use: { ...devices['Desktop Chrome'], baseURL: ONBOARDING_BASE, extraHTTPHeaders: { 'x-real-ip': '10.0.0.5' } } },
    {
      name: 'onboarding-mobile',
      testMatch: ONBOARDING,
      use: { ...devices['Pixel 7'], viewport: { width: 390, height: 844 }, baseURL: ONBOARDING_BASE, extraHTTPHeaders: { 'x-real-ip': '10.0.0.6' } },
    },
    // app do lavador (PWA Android): só o spec dele, no Pixel 7 e no menor Android comum
    { name: 'android', testMatch: LAVADOR, use: { ...devices['Pixel 7'], viewport: { width: 412, height: 915 }, extraHTTPHeaders: { 'x-real-ip': '10.0.0.3' } } },
    { name: 'android-small', testMatch: [LAVADOR, PAINEL], use: { ...devices['Pixel 7'], viewport: { width: 360, height: 640 }, extraHTTPHeaders: { 'x-real-ip': '10.0.0.4' } } },
  ],
  webServer: [
    {
      command: `${BUILD}cp -R .next/static .next/standalone/.next/ && cp -R public .next/standalone/ && node .next/standalone/server.js`,
      url: `${BASE}/api/auth/get-session`,
      ...SERVIDOR,
      env: { ...SERVIDOR.env, PORT: String(PORT), BETTER_AUTH_URL: BASE, LAVAOS_SETUP_TOKEN: '' }, // assistente desligado
    },
    // os webServers sobem em sequência: este reaproveita o build e os estáticos copiados pelo primeiro
    {
      command: 'node .next/standalone/server.js',
      url: `${ONBOARDING_BASE}/api/auth/get-session`,
      ...SERVIDOR,
      env: {
        ...SERVIDOR.env,
        PORT: String(E2E_ONBOARDING.port),
        BETTER_AUTH_URL: ONBOARDING_BASE,
        LAVAOS_SETUP_TOKEN: E2E_ONBOARDING.token,
        PGOPTIONS: `-c search_path=${E2E_ONBOARDING.schema}`, // o pg lê do ambiente: todas as conexões caem no schema sem lava jato
      },
    },
  ],
});
