/**
 * Zera lavaos_test, aplica as migrations e cria o tenant do piloto E2E com dono/gerente/recepção/lavador.
 * Segredos gerados por execução e entregues aos workers só por process.env (nada em disco ou log).
 * Sem imports de src/: lá tudo é server-only.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { assertTestDb, testUrls } from '../helpers/test-db';

export const E2E_PILOT_SLUG = 'e2e';

export default async function globalSetup() {
  assertTestDb(testUrls.owner);
  assertTestDb(testUrls.app);
  const pool = new pg.Pool({ connectionString: testUrls.owner, max: 1 });
  try {
    await pool.query('DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;');
    await pool.query('GRANT USAGE ON SCHEMA public TO lavaos_app');
    await migrate(drizzle(pool), { migrationsFolder: 'drizzle' });
    // DML do lavaos_app vem do ALTER DEFAULT PRIVILEGES de scripts/db-local-init.sql (não das migrations); o owner insere as fixtures
    const senha = `e2e-${randomUUID()}`;
    const pin = `0${randomInt(100, 1000)}`; // zero inicial de propósito
    const hashSenha = await hashPassword(senha);
    const {
      rows: [t],
    } = await pool.query('insert into lava_jatos (nome, slug) values ($1, $2) returning id', ['Lava Jato E2E', E2E_PILOT_SLUG]);
    for (const perfil of ['dono', 'gerente', 'recepcao', 'lavador'] as const) {
      const nome = `${perfil[0].toUpperCase()}${perfil.slice(1)} E2E`;
      const id = randomUUID();
      const email = perfil === 'lavador' ? `${id}@lavador.invalid` : `${perfil}@e2e.test`;
      await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [id, nome, email]);
      const {
        rows: [m],
      } = await pool.query('insert into membros (tenant_id, user_id, perfil, nome_exibicao) values ($1, $2, $3, $4) returning id', [t.id, id, perfil, nome]);
      if (perfil === 'lavador') {
        await pool.query('insert into credenciais_lavador (tenant_id, membro_id, usuario_normalizado, pin_hash) values ($1, $2, $3, $4)', [
          t.id,
          m.id,
          'lavador.e2e',
          await hashPassword(pin),
        ]);
      } else {
        await pool.query(`insert into account (user_id, account_id, provider_id, password) values ($1, $2, 'credential', $3)`, [id, id, hashSenha]);
      }
    }
    // staff com vínculo ativo em dois lava jatos: precisa escolher um no login
    const {
      rows: [b],
    } = await pool.query('insert into lava_jatos (nome, slug) values ($1, $2) returning id', ['Lava Jato E2E B', `${E2E_PILOT_SLUG}-b`]);
    const multi = randomUUID();
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [multi, 'Multi E2E', 'multi@e2e.test']);
    await pool.query(`insert into account (user_id, account_id, provider_id, password) values ($1, $2, 'credential', $3)`, [multi, multi, hashSenha]);
    await pool.query(`insert into membros (tenant_id, user_id, perfil, nome_exibicao) values ($1, $3, 'recepcao', 'Multi E2E'), ($2, $3, 'gerente', 'Multi E2E')`, [
      t.id,
      b.id,
      multi,
    ]);
    // lavador de B: alvo alheio da suíte adversarial (foundation-security)
    const lavB = randomUUID();
    await pool.query('insert into "user" (id, name, email) values ($1, $2, $3)', [lavB, 'Lavador B E2E', `${lavB}@lavador.invalid`]);
    const {
      rows: [mb],
    } = await pool.query(`insert into membros (tenant_id, user_id, perfil, nome_exibicao) values ($1, $2, 'lavador', 'Lavador B E2E') returning id`, [b.id, lavB]);
    await pool.query('insert into credenciais_lavador (tenant_id, membro_id, usuario_normalizado, pin_hash) values ($1, $2, $3, $4)', [
      b.id,
      mb.id,
      'lavador.b',
      await hashPassword(pin),
    ]);
    Object.assign(process.env, { E2E_SENHA: senha, E2E_PIN: pin });
  } finally {
    await pool.end();
  }
}
