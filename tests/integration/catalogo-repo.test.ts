import { describe, expect, it } from 'vitest';
import { createTenantGuards } from '@/lib/auth/context';
import { portes, precos, servicos, session } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { listarPortes, listarServicosComPrecos, listarServicosDisponiveis } from '@/modules/catalogo/catalogo.repo';
import { withTestDatabase } from '../helpers/db';
import { createFoundationFixtures, type FoundationFixtures } from '../helpers/fixtures';

async function ctxOf(db: Database, userId: string, tenantId: string) {
  const [s] = await db
    .insert(session)
    .values({ userId, activeOrganizationId: tenantId, expiresAt: new Date(Date.now() + 3_600_000), token: crypto.randomUUID() })
    .returning();
  return createTenantGuards({
    readSession: async () => ({ session: { id: s.id, userId, expiresAt: s.expiresAt, activeOrganizationId: tenantId } }),
    database: db,
  }).requireTenantContext(new Headers());
}

async function semear(db: Database, f: FoundationFixtures) {
  const tenantId = f.a.tenantId;
  const [p1, p2] = await db.insert(portes).values([{ tenantId, nome: 'Pequeno', ordem: 1 }, { tenantId, nome: 'Grande', ordem: 2 }]).returning();
  const base = { tenantId, comissaoTipo: 'percentual', comissaoValor: 3000 } as const;
  const [completa, semPreco, inativo, cera] = await db
    .insert(servicos)
    .values([
      { ...base, nome: 'Lavagem completa' },
      { ...base, nome: 'Sem preço no porte' },
      { ...base, nome: 'Inativo', ativo: false },
      { ...base, nome: 'Cera', adicional: true },
    ])
    .returning();
  await db.insert(precos).values([
    { tenantId, servicoId: completa.id, porteId: p1.id, valorCentavos: 5000 },
    { tenantId, servicoId: completa.id, porteId: p2.id, valorCentavos: 8000 },
    { tenantId, servicoId: semPreco.id, porteId: p2.id, valorCentavos: 1000 },
    { tenantId, servicoId: inativo.id, porteId: p1.id, valorCentavos: 2000 },
    { tenantId, servicoId: cera.id, porteId: p1.id, valorCentavos: 1500 },
  ]);
  return { p1, p2, completa };
}

describe('catalogo.repo', () => {
  it('serviço sem preço para o porte não aparece em listarServicosDisponiveis', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { p1, p2 } = await semear(db, f);
      const ctx = await ctxOf(db, f.a.membros.recepcao.userId, f.a.tenantId);
      expect((await listarServicosDisponiveis(ctx, p1.id, db)).map((s) => s.nome)).not.toContain('Sem preço no porte');
      expect((await listarServicosDisponiveis(ctx, p2.id, db)).map((s) => s.nome)).toContain('Sem preço no porte');
      expect(await listarServicosDisponiveis(ctx, 'nao-e-uuid', db)).toEqual([]);
    }));

  it('serviço inativo não aparece', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { p1 } = await semear(db, f);
      const ctx = await ctxOf(db, f.a.membros.recepcao.userId, f.a.tenantId);
      expect((await listarServicosDisponiveis(ctx, p1.id, db)).map((s) => s.nome)).not.toContain('Inativo');
    }));

  it('adicional aparece marcado em listarServicosDisponiveis', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { p1 } = await semear(db, f);
      const ctx = await ctxOf(db, f.a.membros.recepcao.userId, f.a.tenantId);
      const lista = await listarServicosDisponiveis(ctx, p1.id, db);
      expect(lista).toEqual([
        { id: expect.any(String), nome: 'Cera', valorCentavos: 1500, adicional: true },
        { id: expect.any(String), nome: 'Lavagem completa', valorCentavos: 5000, adicional: false },
      ]);
    }));

  it('tenant B não vê catálogo do A', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { p1 } = await semear(db, f);
      const ctxB = await ctxOf(db, f.b.membros.dono.userId, f.b.tenantId);
      expect(await listarPortes(ctxB, db)).toEqual([]);
      expect(await listarServicosComPrecos(ctxB, db)).toEqual([]);
      expect(await listarServicosDisponiveis(ctxB, p1.id, db)).toEqual([]);
      const ctxA = await ctxOf(db, f.a.membros.dono.userId, f.a.tenantId);
      expect((await listarPortes(ctxA, db)).map((p) => p.nome)).toEqual(['Pequeno', 'Grande']);
      const comPrecos = await listarServicosComPrecos(ctxA, db);
      expect(comPrecos).toHaveLength(4);
      expect(comPrecos.find((s) => s.nome === 'Lavagem completa')).toMatchObject({ comissaoTipo: 'percentual', comissaoValor: 3000, precos: expect.arrayContaining([{ porteId: p1.id, valorCentavos: 5000 }]) });
    }));
});
