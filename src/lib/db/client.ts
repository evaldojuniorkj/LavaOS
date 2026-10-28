import 'server-only';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getServerEnv } from '@/lib/env';
import * as schema from './schema';
import type { Database } from './types';

export function createDatabase(url: string): { db: Database; close(): Promise<void> } {
  const pool = new Pool({ connectionString: url, max: 10 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

let shared: Database | undefined;
/** Pool compartilhado do runtime. A conexão LISTEN dedicada da Fase 1 ficará fora dele. */
export function getDatabase(): Database {
  return (shared ??= createDatabase(getServerEnv().DATABASE_URL).db);
}
