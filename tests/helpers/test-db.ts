/**
 * Fonte única das URLs do banco de testes: Vitest (helpers/db.ts), playwright.config (servidor sob teste)
 * e o global-setup E2E (limpeza/fixtures) leem daqui, então nunca apontam para bancos diferentes.
 * Sem imports de src/: lá tudo é server-only.
 */
try {
  process.loadEnvFile('.env.local');
} catch {} // sem .env.local usamos os padrões do compose local (o CI usa os mesmos, via serviço em localhost)

const LOCAL = 'postgres://%s@127.0.0.1:55432/lavaos_test';
const forTest = (url: string) => {
  const u = new URL(url);
  u.pathname = '/lavaos_test';
  return u.toString();
};

export const testUrls = {
  owner: forTest(process.env.MIGRATION_DATABASE_URL ?? LOCAL.replace('%s', 'lavaos_owner:owner_local_dev')),
  app: process.env.TEST_DATABASE_URL ?? LOCAL.replace('%s', 'lavaos_app:app_local_dev'),
};

/** Trava de segurança: só opera destrutivamente em lavaos_test local. */
export function assertTestDb(url: string) {
  const u = new URL(url);
  // query/hash poderiam sobrescrever o host (?host=remoto) depois da checagem
  if (u.search || u.hash || u.pathname !== '/lavaos_test' || !['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) {
    throw new Error(`Recusado: ${u.hostname}${u.pathname} não é o banco de testes local`);
  }
}
