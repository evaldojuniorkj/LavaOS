import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { assertTestDb, testUrls } from '../helpers/db';

const journal = JSON.parse(readFileSync('drizzle/meta/_journal.json', 'utf8')) as { entries: unknown[] };

// Toda suíte de integração zera lavaos_test no início, então deixá-lo migrado aqui não afeta as outras.
async function zerar() {
  const owner = new Pool({ connectionString: testUrls.owner, max: 1 });
  try {
    await owner.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public; GRANT USAGE ON SCHEMA public TO lavaos_app;');
  } finally {
    await owner.end();
  }
}

async function estado() {
  const owner = new Pool({ connectionString: testUrls.owner, max: 1 });
  try {
    const tabelas = await owner.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
    const aplicadas = await owner.query('select hash, created_at from drizzle.__drizzle_migrations order by id');
    return { tabelas: tabelas.rows.map((r) => r.table_name as string), aplicadas: aplicadas.rows };
  } finally {
    await owner.end();
  }
}

const rodar = (args: string[]) => execFileSync(process.execPath, args, { env: { ...process.env, MIGRATION_DATABASE_URL: testUrls.owner }, stdio: 'pipe' });
const script = () => rodar(['scripts/migrate.ts']);
const drizzleKit = () => rodar(['./node_modules/drizzle-kit/bin.cjs', 'migrate']);

describe('scripts/migrate.ts', () => {
  it('banco vazio fica igual ao migrado pelo drizzle-kit, e um aceita o banco do outro', async () => {
    assertTestDb(testUrls.owner);
    await zerar();
    drizzleKit();
    const kit = await estado();

    await zerar();
    script();
    const meu = await estado();
    expect(meu.tabelas.length).toBeGreaterThan(0);
    expect(meu).toEqual(kit);
    expect(meu.aplicadas).toHaveLength(journal.entries.length);

    // rodar de novo (pelos dois) não reaplica nada
    drizzleKit();
    script();
    expect(await estado()).toEqual(meu);
  }, 60_000);
});
