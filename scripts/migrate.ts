/**
 * Aplica drizzle/ com a role de DDL (MIGRATION_DATABASE_URL): `node scripts/migrate.ts` (da raiz do projeto: a pasta é relativa ao cwd).
 * Existe para a imagem de produção, que não leva o drizzle-kit. Usa a mesma tabela de controle dele
 * (drizzle.__drizzle_migrations, o padrão do migrator), então um banco migrado por um é aceito pelo outro.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

const url = process.env.MIGRATION_DATABASE_URL;
if (!url) {
  console.error('migrate recusado: defina MIGRATION_DATABASE_URL');
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
  console.log('migrations aplicadas');
} finally {
  await pool.end();
}
