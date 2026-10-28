import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { account, lavaJatos, membros, user } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import '../helpers/auth'; // env de teste para o auth do login HTTP
import { testUrls, withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

const exec = promisify(execFile);
const SLUG = 'piloto-seed';
const EMAIL = 'dono.seed@teste.invalid';

/** Roda o script como `pnpm db:seed:dev` rodaria, só com o env dado (stdin não é TTY: sem prompt). */
async function seed(env: Record<string, string | undefined>) {
  const base = { PATH: process.env.PATH, DATABASE_URL: testUrls.app, LAVAOS_MODE: 'test', LAVAOS_PILOT_SLUG: SLUG, SEED_OWNER_EMAIL: EMAIL };
  try {
    const r = await exec('node', ['scripts/seed-dev.ts'], { env: { ...base, ...env } as unknown as NodeJS.ProcessEnv });
    return { code: 0, out: r.stdout + r.stderr };
  } catch (err) {
    const e = err as { code: number; stdout: string; stderr: string };
    return { code: e.code, out: e.stdout + e.stderr };
  }
}

const contagem = async (db: Database) =>
  JSON.stringify(await Promise.all([lavaJatos, user, account, membros].map(async (t) => (await db.execute(sql`select count(*) from ${t}`)).rows)));

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('pnpm db:seed:dev', () => {
  it('cria tenant e dono; reexecução não altera credenciais; senha nunca aparece na saída', () =>
    withTestDatabase(async (db) => {
      const senha = `senha-${crypto.randomUUID()}`;
      const r = await seed({ SEED_OWNER_PASSWORD: senha });
      expect(r.code, r.out).toBe(0);
      expect(r.out).not.toContain(senha);
      const [t] = await db.select().from(lavaJatos).where(eq(lavaJatos.slug, SLUG));
      const [m] = await db.select().from(membros).where(eq(membros.tenantId, t.id));
      expect(m).toMatchObject({ perfil: 'dono', ativo: true });
      const [conta] = await db.select().from(account).where(eq(account.userId, m.userId));
      expect(conta).toMatchObject({ providerId: 'credential', accountId: m.userId });
      expect(conta.password).not.toContain(senha);
      expect((await db.select().from(user).where(eq(user.id, m.userId)))[0].email).toBe(EMAIL);
      expect((await createHttp().post('/sign-in/email', { email: EMAIL, password: senha })).status).toBe(200);

      const antes = await contagem(db);
      const outra = `outra-${crypto.randomUUID()}`;
      const de_novo = await seed({ SEED_OWNER_PASSWORD: outra });
      expect(de_novo.code, de_novo.out).toBe(0);
      expect(de_novo.out).not.toContain(outra);
      expect(await contagem(db)).toBe(antes);
      expect((await db.select().from(account).where(eq(account.userId, m.userId)))[0].password).toBe(conta.password);
      expect((await createHttp().post('/sign-in/email', { email: EMAIL, password: senha })).status).toBe(200);
    }));

  it.each([
    ['modo production', { LAVAOS_MODE: 'production' }],
    ['modo ausente', { LAVAOS_MODE: undefined }],
    ['banco de produção local', { DATABASE_URL: testUrls.app.replace('/lavaos_test', '/lavaos') }],
    ['host remoto', { DATABASE_URL: 'postgres://u:p@db.exemplo.com:5432/lavaos_dev' }],
    ['host sobrescrito por query', { DATABASE_URL: `${testUrls.app}?host=db.exemplo.com` }],
    ['senha ausente', { SEED_OWNER_PASSWORD: undefined }],
    ['senha curta', { SEED_OWNER_PASSWORD: 'curta' }],
    ['e-mail inválido', { SEED_OWNER_EMAIL: 'nao-e-email' }],
  ])('recusa %s sem tocar no banco', (_nome, env) =>
    withTestDatabase(async (db) => {
      const antes = await contagem(db);
      const r = await seed({ SEED_OWNER_PASSWORD: 'senha-valida-123', ...env });
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/seed-dev recusado/);
      expect(r.out).not.toContain('senha-valida-123');
      expect(await contagem(db)).toBe(antes);
    }),
  );
});
