import { eq, sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { lavaJatos, ordensServico, osItens, portes, servicos, precos, veiculos, osEventos, osContadores } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { withTestDatabase } from '../helpers/db';
import { createFoundationFixtures, type FoundationFixtures } from '../helpers/fixtures';

async function pgCode(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    const err = e as { code?: string; cause?: { code?: string } };
    return err.cause?.code ?? err.code;
  }
}

type T = FoundationFixtures['a'];

async function catalogo(db: Database, t: T) {
  const [porte] = await db.insert(portes).values({ tenantId: t.tenantId, nome: 'Carro' }).returning();
  const [servico] = await db.insert(servicos).values({ tenantId: t.tenantId, nome: 'Lavagem', comissaoTipo: 'percentual', comissaoValor: 3000 }).returning();
  return { porte, servico };
}

async function osBase(db: Database, t: T) {
  const { porte, servico } = await catalogo(db, t);
  const [veiculo] = await db.insert(veiculos).values({ tenantId: t.tenantId, placa: 'ABC1234', porteId: porte.id }).returning();
  const os = (over: Partial<typeof ordensServico.$inferInsert> = {}) =>
    db.insert(ordensServico).values({ tenantId: t.tenantId, numero: 1, veiculoId: veiculo.id, tokenPublico: crypto.randomUUID(), abertaPor: t.membros.recepcao.memberId, ...over }).returning();
  return { porte, servico, veiculo, os };
}

describe('schema da Fase 1', () => {
  it('rejeita placa duplicada no mesmo tenant e aceita em outro', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { porte } = await catalogo(db, f.a);
      const { porte: porteB } = await catalogo(db, f.b);
      await db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: 'ABC1234', porteId: porte.id });
      expect(await pgCode(db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: 'ABC1234', porteId: porte.id }))).toBe('23505');
      await db.insert(veiculos).values({ tenantId: f.b.tenantId, placa: 'ABC1234', porteId: porteB.id });
      // porte de outro tenant (FK composta)
      expect(await pgCode(db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: 'XYZ9A99', porteId: porteB.id }))).toBe('23503');
    }));

  it('rejeita preco duplicado por servico+porte', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { porte, servico } = await catalogo(db, f.a);
      const preco = { tenantId: f.a.tenantId, servicoId: servico.id, porteId: porte.id, valorCentavos: 5000 };
      await db.insert(precos).values(preco);
      expect(await pgCode(db.insert(precos).values(preco))).toBe('23505');
    }));

  it('rejeita os_item cujo servico é de outro tenant', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { porte, servico, os } = await osBase(db, f.a);
      const { servico: servicoB } = await catalogo(db, f.b);
      const [o] = await os();
      const item = { tenantId: f.a.tenantId, osId: o.id, porteId: porte.id, nomeServico: 'Lavagem', valorCentavos: 5000, comissaoTipo: 'fixo', comissaoValor: 500 } as const;
      expect(await pgCode(db.insert(osItens).values({ ...item, servicoId: servicoB.id }))).toBe('23503');
      expect(await db.insert(osItens).values({ ...item, servicoId: servico.id }).returning()).toHaveLength(1);
    }));

  it('rejeita status inválido', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { os } = await osBase(db, f.a);
      expect(await pgCode(os({ status: 'invalido' as never }))).toBe('23514');
      const [ok] = await os();
      expect(ok.status).toBe('aguardando');
      expect(ok.inicioLavagemEm).toBeNull();
    }));

  it('numero único por tenant', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { os } = await osBase(db, f.a);
      await os();
      expect(await pgCode(os())).toBe('23505');
      expect(await pgCode(db.insert(osContadores).values([{ tenantId: f.a.tenantId }, { tenantId: f.a.tenantId }]))).toBe('23505');
    }));

  it('rejeita responsavel_id de membro de outro tenant', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { os } = await osBase(db, f.a);
      expect(await pgCode(os({ responsavelId: f.b.membros.lavador.memberId }))).toBe('23503');
      expect(await pgCode(os({ abertaPor: f.b.membros.recepcao.memberId }))).toBe('23503');
      const [ok] = await os({ responsavelId: f.a.membros.lavador.memberId, atribuidoEm: new Date() });
      expect(ok.responsavelId).toBe(f.a.membros.lavador.memberId);
      expect(await pgCode(db.insert(osEventos).values({ tenantId: f.a.tenantId, osId: ok.id, tipo: 'reabertura' as never, membroId: f.a.membros.dono.memberId }))).toBe('23514');
    }));

  it('rejeita comissao_tipo inválido', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const base = { tenantId: f.a.tenantId, nome: 'X' };
      expect(await pgCode(db.insert(servicos).values({ ...base, comissaoTipo: 'bonus' as never, comissaoValor: 1 }))).toBe('23514');
      expect(await pgCode(db.insert(servicos).values({ ...base, comissaoTipo: 'percentual', comissaoValor: 10001 }))).toBe('23514');
      expect(await pgCode(db.insert(servicos).values({ ...base, comissaoTipo: 'fixo', comissaoValor: -1 }))).toBe('23514');
      expect(await pgCode(db.insert(servicos).values({ ...base, comissaoTipo: 'fixo', comissaoValor: 0 }))).toBeUndefined();
    }));

  it('insert que referencia o tenant não espera a trava de mudança de equipe', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { porte } = await catalogo(db, f.a);
      let inserido: unknown;
      await db.transaction(async (tx) => {
        // mesma trava de travarAtor em equipe.service.ts
        await tx.select({ id: lavaJatos.id }).from(lavaJatos).where(eq(lavaJatos.id, f.a.tenantId)).for('no key update');
        inserido = await db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: 'ABC1234', porteId: porte.id }).returning();
        const esperando = await db.execute<{ n: number }>(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
        expect(esperando.rows[0].n).toBe(0);
      });
      expect(inserido).toHaveLength(1);
    }));
});
