import { count, eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { credenciaisLavador, lavaJatos, membros, user } from '@/lib/db/schema';
import { applyMigrations, testUrls, withTestDatabase } from '../helpers/db';
import { createFoundationFixtures } from '../helpers/fixtures';

/** Código SQLSTATE do erro do pg (Drizzle embrulha em `cause`). */
async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
}

describe('schema da Fundação', () => {
  it('impede membro duplicado no mesmo tenant', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const dup = db.insert(membros).values({ tenantId: f.a.tenantId, userId: f.a.membros.dono.userId, perfil: 'gerente', nomeExibicao: 'dup' });
      expect(await pgCode(dup)).toBe('23505');
    }));

  it('recusa credencial vinculada a membro de outro tenant', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const cred = db.insert(credenciaisLavador).values({
        tenantId: f.a.tenantId,
        membroId: f.b.membros.lavador.memberId,
        usuarioNormalizado: 'joao',
        pinHash: 'hash',
      });
      expect(await pgCode(cred)).toBe('23503');
      const ok = await db.insert(credenciaisLavador).values({ tenantId: f.a.tenantId, membroId: f.a.membros.lavador.memberId, usuarioNormalizado: 'joao', pinHash: 'hash' }).returning();
      expect(ok).toHaveLength(1);
      const dupUser = db.insert(credenciaisLavador).values({ tenantId: f.a.tenantId, membroId: f.a.membros.dono.memberId, usuarioNormalizado: 'joao', pinHash: 'hash' });
      expect(await pgCode(dupUser)).toBe('23505');
    }));

  it('usa UUIDs e timestamps validos', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
      const [t] = await db.select().from(lavaJatos).where(eq(lavaJatos.id, f.a.tenantId));
      const [m] = await db.select().from(membros).where(eq(membros.id, f.a.membros.dono.memberId));
      const [u] = await db.select().from(user).where(eq(user.id, f.a.membros.dono.userId));
      for (const id of [t.id, m.id, m.tenantId, m.userId, u.id]) expect(id).toMatch(uuid);
      for (const d of [t.createdAt, t.updatedAt, m.createdAt, m.updatedAt, u.createdAt]) {
        expect(d).toBeInstanceOf(Date);
        expect(Math.abs(Date.now() - d.getTime())).toBeLessThan(60_000);
      }
      expect(m.ativo).toBe(true);
    }));

  it('migration reaplicada preserva dados', () =>
    withTestDatabase(async (db) => {
      await createFoundationFixtures(db);
      const contar = async () => [(await db.select({ n: count() }).from(lavaJatos))[0].n, (await db.select({ n: count() }).from(membros))[0].n, (await db.select({ n: count() }).from(user))[0].n];
      const antes = await contar();
      expect(antes).toEqual([2, 10, 9]);
      await applyMigrations(testUrls.owner);
      expect(await contar()).toEqual(antes);
    }));

  it('não cria tabelas de fases futuras', () =>
    withTestDatabase(async (db) => {
      const { rows } = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.tables where table_schema = 'public'`);
      const nomes = rows.map((r) => r.table_name);
      expect(nomes).toEqual(expect.arrayContaining(['lava_jatos', 'membros', 'credenciais_lavador', 'user', 'session']));
      expect(nomes.filter((n) => /ordens|os_|caixa|pagamento|despesa|comiss|acerto|fidelidade|beneficio|agendamento|servico|cliente|veiculo/.test(n))).toEqual([]);
    }));

  it('runtime não executa DDL mas faz DML', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const app = new Pool({ connectionString: testUrls.app, max: 1 });
      try {
        for (const ddl of ['create table x (id int)', 'drop table membros', 'alter table membros add column x int', 'truncate membros']) {
          expect(await pgCode(app.query(ddl)), ddl).toBe('42501');
        }
        await db.update(membros).set({ ativo: false }).where(eq(membros.id, f.a.membros.lavador.memberId));
        await db.delete(membros).where(eq(membros.id, f.a.membros.lavador.memberId));
      } finally {
        await app.end();
      }
    }));
});
