import { describe, expect, it } from 'vitest';
import { caixas, categoriasDespesa, despesas, ordensServico, pagamentos, portes, veiculos } from '@/lib/db/schema';
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

const caixa = (db: Database, t: T, over: Partial<typeof caixas.$inferInsert> = {}) =>
  db.insert(caixas).values({ tenantId: t.tenantId, data: '2026-10-31', trocoInicialCentavos: 10000, abertoPor: t.membros.recepcao.memberId, ...over }).returning();

async function osComCaixa(db: Database, t: T) {
  const [porte] = await db.insert(portes).values({ tenantId: t.tenantId, nome: 'Carro' }).returning();
  const [veiculo] = await db.insert(veiculos).values({ tenantId: t.tenantId, placa: 'ABC1234', porteId: porte.id }).returning();
  const [os] = await db
    .insert(ordensServico)
    .values({ tenantId: t.tenantId, numero: 1, veiculoId: veiculo.id, tokenPublico: crypto.randomUUID(), abertaPor: t.membros.recepcao.memberId, totalCentavos: 5000 })
    .returning();
  const [cx] = await caixa(db, t);
  return { os, cx };
}

describe('schema da Fase 4', () => {
  it('um caixa aberto por tenant e um caixa por dia', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      await caixa(db, f.a);
      expect(await pgCode(caixa(db, f.a, { data: '2026-11-01' }))).toBe('23505');
      expect(await pgCode(caixa(db, f.a, { status: 'fechado' }))).toBe('23505');
      expect(await caixa(db, f.a, { data: '2026-11-01', status: 'fechado' })).toHaveLength(1);
      expect(await caixa(db, f.b)).toHaveLength(1);
      expect(await pgCode(caixa(db, f.a, { data: '2026-11-02', status: 'fechado', trocoInicialCentavos: -1 }))).toBe('23514');
      expect(await pgCode(caixa(db, f.a, { data: '2026-11-03', status: 'fechado', abertoPor: f.b.membros.recepcao.memberId }))).toBe('23503');
    }));

  it('pagamento com valor 0 ou estorno incompleto é recusado; DELETE é negado ao lavaos_app', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { os, cx } = await osComCaixa(db, f.a);
      const base = { tenantId: f.a.tenantId, osId: os.id, caixaId: cx.id, forma: 'pix', valorCentavos: 5000, recebidoPor: f.a.membros.recepcao.memberId } as const;
      expect(await pgCode(db.insert(pagamentos).values({ ...base, valorCentavos: 0 }))).toBe('23514');
      expect(await pgCode(db.insert(pagamentos).values({ ...base, forma: 'cheque' as never }))).toBe('23514');
      expect(await pgCode(db.insert(pagamentos).values({ ...base, estornadoEm: new Date() }))).toBe('23514');
      const [p] = await db.insert(pagamentos).values(base).returning();
      expect(p.estornadoEm).toBeNull();
      expect(await pgCode(db.delete(pagamentos))).toBe('42501');
      expect(await pgCode(db.delete(caixas))).toBe('42501');
      expect(await pgCode(db.delete(despesas))).toBe('42501');
      expect(await pgCode(db.delete(categoriasDespesa))).toBe('42501');
    }));

  it('despesa exige pago_em ou vencimento; do caixa exige pago_em', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { cx } = await osComCaixa(db, f.a);
      const [cat] = await db.select().from(categoriasDespesa).limit(1);
      const base = { tenantId: f.a.tenantId, categoriaId: cat.id, descricao: 'Shampoo', valorCentavos: 3000, lancadaPor: f.a.membros.gerente.memberId };
      expect(await pgCode(db.insert(despesas).values(base))).toBe('23514');
      expect(await pgCode(db.insert(despesas).values({ ...base, vencimento: '2026-11-10', caixaId: cx.id }))).toBe('23514');
      expect(await pgCode(db.insert(despesas).values({ ...base, valorCentavos: 0, vencimento: '2026-11-10' }))).toBe('23514');
      expect(await db.insert(despesas).values({ ...base, vencimento: '2026-11-10' }).returning()).toHaveLength(1);
      expect(await db.insert(despesas).values({ ...base, pagoEm: new Date(), caixaId: cx.id }).returning()).toHaveLength(1);
    }));

  it('fixture cria as 6 categorias padrão por tenant, Vales e Comissões de sistema; nome único no tenant', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const cats = await db.select().from(categoriasDespesa);
      expect(cats).toHaveLength(12);
      const doA = cats.filter((c) => c.tenantId === f.a.tenantId);
      expect(doA.map((c) => [c.nome, c.sistema, c.ativo]).sort()).toEqual([
        ['Aluguel', false, true],
        ['Comissões', true, true],
        ['Outros', false, true],
        ['Produtos', false, true],
        ['Vales', true, true],
        ['Água e luz', false, true],
      ]);
      expect(await pgCode(db.insert(categoriasDespesa).values({ tenantId: f.a.tenantId, nome: 'Vales' }))).toBe('23505');
    }));
});
