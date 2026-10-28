import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createDatabase } from '@/lib/db/client';
import type { Database } from '@/lib/db/types';

try {
  process.loadEnvFile('.env.local');
} catch {} // sem .env.local usamos os padrões do compose local

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
  if (u.search || u.hash || u.pathname !== '/lavaos_test' || !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(u.hostname)) {
    throw new Error(`Recusado: ${u.hostname}${u.pathname} não é o banco de testes local`);
  }
}

export async function applyMigrations(ownerUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  } finally {
    await pool.end();
  }
}

/** Zera lavaos_test, aplica as migrations e entrega o Database com a role de runtime (DML). */
export async function withTestDatabase(fn: (db: Database) => Promise<void>): Promise<void> {
  assertTestDb(testUrls.owner);
  assertTestDb(testUrls.app);
  const owner = new Pool({ connectionString: testUrls.owner, max: 1 });
  try {
    await owner.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
    await owner.query('GRANT USAGE ON SCHEMA public TO lavaos_app');
  } finally {
    await owner.end();
  }
  await applyMigrations(testUrls.owner);
  const { db, close } = createDatabase(testUrls.app);
  try {
    await fn(db);
  } finally {
    await close();
  }
}
