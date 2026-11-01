import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createDatabase } from '@/lib/db/client';
import type { Database } from '@/lib/db/types';
import { assertTestDb, testUrls } from './test-db';

export { assertTestDb, testUrls };

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
