import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTenantGuards } from '@/lib/auth/context';
import { membros, session } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { withTestDatabase } from '../helpers/db';
import { createFoundationFixtures, type FoundationFixtures } from '../helpers/fixtures';

const NOW = new Date('2026-10-12T12:00:00Z');
const FUTURE = new Date('2026-10-20T12:00:00Z');
const headers = new Headers();

type Claims = { id: string; userId: string; expiresAt: Date; activeOrganizationId: string | null };

async function seedSession(db: Database, userId: string, orgId: string | null, expiresAt = FUTURE): Promise<Claims> {
  const [s] = await db
    .insert(session)
    .values({ userId, activeOrganizationId: orgId, expiresAt, token: crypto.randomUUID() })
    .returning();
  return { id: s.id, userId, expiresAt, activeOrganizationId: orgId };
}

const guards = (db: Database, claims: Claims | null) =>
  createTenantGuards({ readSession: async () => (claims ? { session: claims } : null), database: db, now: () => NOW });

const run = (fn: (db: Database, f: FoundationFixtures) => Promise<void>) =>
  withTestDatabase(async (db) => fn(db, await createFoundationFixtures(db)));

describe('requireTenantContext', () => {
  it('emite contexto com dados vindos do banco', () =>
    run(async (db, f) => {
      const m = f.a.membros.gerente;
      const ctx = await guards(db, await seedSession(db, m.userId, f.a.tenantId)).requireTenantContext(headers);
      expect(ctx).toMatchObject({ tenantId: f.a.tenantId, userId: m.userId, memberId: m.memberId, perfil: 'gerente' });
    }));

  it('perfil vem do banco, não da sessão', () =>
    run(async (db, f) => {
      const m = f.a.membros.gerente;
      const claims = await seedSession(db, m.userId, f.a.tenantId);
      await db.update(membros).set({ perfil: 'recepcao' }).where(eq(membros.id, m.memberId));
      expect((await guards(db, claims).requireTenantContext(headers)).perfil).toBe('recepcao');
    }));

  it('mesmo usuário em dois tenants usa só o tenant ativo da sessão', () =>
    run(async (db, f) => {
      const a = await guards(db, await seedSession(db, f.multi.userId, f.a.tenantId)).requireTenantContext(headers);
      const b = await guards(db, await seedSession(db, f.multi.userId, f.b.tenantId)).requireTenantContext(headers);
      expect([a.tenantId, a.perfil, a.memberId]).toEqual([f.a.tenantId, 'recepcao', f.multi.memberIdA]);
      expect([b.tenantId, b.perfil, b.memberId]).toEqual([f.b.tenantId, 'gerente', f.multi.memberIdB]);
    }));

  it('nega sem sessão', () =>
    run(async (db) => {
      await expect(guards(db, null).requireTenantContext(headers)).rejects.toThrow('acesso negado');
    }));

  it('nega tenant ativo ausente, inexistente ou de outro usuário', () =>
    run(async (db, f) => {
      const u = f.a.membros.recepcao.userId;
      for (const org of [null, crypto.randomUUID(), f.b.tenantId]) {
        await expect(guards(db, await seedSession(db, u, org)).requireTenantContext(headers)).rejects.toThrow('acesso negado');
      }
    }));

  it('nega claim adulterado: tenant trocado em relação à linha persistida', () =>
    run(async (db, f) => {
      const m = f.multi;
      const claims = await seedSession(db, m.userId, f.a.tenantId);
      await expect(guards(db, { ...claims, activeOrganizationId: f.b.tenantId }).requireTenantContext(headers)).rejects.toThrow('acesso negado');
    }));

  it('nega sessão inexistente no banco e userId que não confere', () =>
    run(async (db, f) => {
      const claims = await seedSession(db, f.a.membros.dono.userId, f.a.tenantId);
      await expect(guards(db, { ...claims, id: crypto.randomUUID() }).requireTenantContext(headers)).rejects.toThrow('acesso negado');
      await expect(guards(db, { ...claims, userId: f.b.membros.dono.userId }).requireTenantContext(headers)).rejects.toThrow('acesso negado');
    }));

  it('nega sessão expirada (linha do banco), mesmo com claim ainda válido', () =>
    run(async (db, f) => {
      const claims = await seedSession(db, f.a.membros.dono.userId, f.a.tenantId, new Date('2026-10-01T00:00:00Z'));
      await expect(guards(db, { ...claims, expiresAt: FUTURE }).requireTenantContext(headers)).rejects.toThrow('acesso negado');
    }));

  it('nega membro inativo imediatamente', () =>
    run(async (db, f) => {
      const m = f.a.membros.lavador;
      const g = guards(db, await seedSession(db, m.userId, f.a.tenantId));
      await expect(g.requireTenantContext(headers)).resolves.toBeDefined();
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, m.memberId));
      await expect(g.requireTenantContext(headers)).rejects.toThrow('acesso negado');
    }));

  it('nega usuário sem vínculo com o tenant', () =>
    run(async (db, f) => {
      await db.delete(membros).where(eq(membros.id, f.a.membros.dono.memberId));
      await expect(guards(db, await seedSession(db, f.a.membros.dono.userId, f.a.tenantId)).requireTenantContext(headers)).rejects.toThrow('acesso negado');
    }));
});

describe('requirePermission', () => {
  it('libera perfil com permissão implantada e nega as demais', () =>
    run(async (db, f) => {
      const dono = guards(db, await seedSession(db, f.a.membros.dono.userId, f.a.tenantId));
      const gerente = guards(db, await seedSession(db, f.a.membros.gerente.userId, f.a.tenantId));
      await expect(dono.requirePermission(headers, 'equipe:gerenciar_lideranca')).resolves.toMatchObject({ perfil: 'dono' });
      await expect(gerente.requirePermission(headers, 'equipe:gerenciar')).resolves.toBeDefined();
      await expect(gerente.requirePermission(headers, 'equipe:gerenciar_lideranca')).rejects.toThrow('acesso negado');
      await expect(dono.requirePermission(headers, 'caixa:operar')).rejects.toThrow('acesso negado');
    }));
});
