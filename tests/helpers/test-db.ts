/**
 * Fonte única das URLs do banco de testes: Vitest (helpers/db.ts), playwright.config (servidor sob teste)
 * e o global-setup E2E (limpeza/fixtures) leem daqui, então nunca apontam para bancos diferentes.
 * Sem imports de src/: lá tudo é server-only.
 */
import pg from 'pg';

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

/** Chave única do advisory lock que Vitest e Playwright disputam: ambos zeram lavaos_test. */
const LOCK_KEY = 7_452_001;

/** Segura o lock numa conexão dedicada até `liberar()` (ou o fim do processo); outra suíte rodando ⇒ aborta. */
export async function travarLavaosTest(): Promise<() => Promise<void>> {
  assertTestDb(testUrls.owner);
  const c = new pg.Client({ connectionString: testUrls.owner });
  await c.connect();
  const { rows } = await c.query('select pg_try_advisory_lock($1) as ok', [LOCK_KEY]);
  if (!rows[0].ok) {
    await c.end();
    throw new Error('outra suíte está usando lavaos_test');
  }
  return () => c.end();
}
