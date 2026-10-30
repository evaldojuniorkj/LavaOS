import 'server-only';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { getServerEnv } from '@/lib/env';
import * as schema from './schema';
import type { Database } from './types';

export function createDatabase(url: string): { db: Database; close(): Promise<void> } {
  const pool = new Pool({ connectionString: url, max: 10 });
  // Erro em conexão ociosa (ex.: restart do Postgres) não pode derrubar o processo; o pool reconecta.
  pool.on('error', (err) => console.error('[db] erro em conexão ociosa do pool:', err.message));
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

// globalThis sobrevive ao HMR do dev, evitando um pool novo a cada reload.
const g = globalThis as { __lavaosDb?: Database };
/** Pool compartilhado do runtime. A conexão LISTEN dedicada fica fora dele (src/lib/realtime/listener.ts). */
export function getDatabase(): Database {
  return (g.__lavaosDb ??= createDatabase(getServerEnv().DATABASE_URL).db);
}
