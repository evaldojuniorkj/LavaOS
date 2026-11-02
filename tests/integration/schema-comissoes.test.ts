import { describe, expect, it } from 'vitest';
import { acertosComissao, categoriasDespesa, comissoes, despesas, ordensServico, osItens, portes, servicos, vales, veiculos } from '@/lib/db/schema';
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

async function osComItem(db: Database, t: T) {
  const [porte] = await db.insert(portes).values({ tenantId: t.tenantId, nome: 'Carro' }).returning();
  const [servico] = await db.insert(servicos).values({ tenantId: t.tenantId, nome: 'Lavagem', comissaoTipo: 'percentual', comissaoValor: 3000 }).returning();
  const [veiculo] = await db.insert(veiculos).values({ tenantId: t.tenantId, placa: 'ABC1234', porteId: porte.id }).returning();
  const [os] = await db
    .insert(ordensServico)
    .values({ tenantId: t.tenantId, numero: 1, veiculoId: veiculo.id, tokenPublico: crypto.randomUUID(), abertaPor: t.membros.recepcao.memberId, totalCentavos: 5000 })
    .returning();
  const [item] = await db
    .insert(osItens)
    .values({ tenantId: t.tenantId, osId: os.id, servicoId: servico.id, porteId: porte.id, nomeServico: 'Lavagem', valorCentavos: 5000, comissaoTipo: 'percentual', comissaoValor: 3000 })
    .returning();
  return { os, item };
}

async function despesa(db: Database, t: T) {
  const [cat] = await db.select().from(categoriasDespesa).limit(1);
  const [d] = await db
    .insert(despesas)
    .values({ tenantId: t.tenantId, categoriaId: cat.id, descricao: 'Vale', valorCentavos: 3000, pagoEm: new Date(), lancadaPor: t.membros.gerente.memberId })
    .returning();
  return d;
}

const acerto = (t: T, over: Partial<typeof acertosComissao.$inferInsert> = {}) => ({
  tenantId: t.tenantId,
  membroId: t.membros.lavador.memberId,
  periodoInicio: '2026-10-25',
  periodoFim: '2026-10-31',
  comissoesCentavos: 20000,
  valesCentavos: 30000,
  saldoAnteriorCentavos: 0,
  pagoCentavos: 0,
  saldoDevedorCentavos: 10000,
  pagoPor: t.membros.gerente.memberId,
  ...over,
});

describe('schema da Fase 5', () => {
  it('uma comissão por item da OS; DELETE em comissões é permitido ao lavaos_app', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const { os, item } = await osComItem(db, f.a);
      const base = { tenantId: f.a.tenantId, osId: os.id, osItemId: item.id, membroId: f.a.membros.lavador.memberId, baseCentavos: 5000, valorCentavos: 1500 };
      await db.insert(comissoes).values(base);
      expect(await pgCode(db.insert(comissoes).values(base))).toBe('23505');
      expect(await pgCode(db.insert(comissoes).values({ ...base, osItemId: crypto.randomUUID() }))).toBe('23503');
      expect(await pgCode(db.insert(comissoes).values({ ...base, valorCentavos: -1 }))).toBe('23514');
      expect(await pgCode(db.insert(comissoes).values({ ...base, tenantId: f.b.tenantId, membroId: f.b.membros.lavador.memberId }))).toBe('23503');
      expect(await db.delete(comissoes).returning()).toHaveLength(1);
    }));

  it('vale exige despesa e valor positivo; cancelamento tem os três campos juntos; sem DELETE', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const d = await despesa(db, f.a);
      const base = { tenantId: f.a.tenantId, membroId: f.a.membros.lavador.memberId, valorCentavos: 3000, dadoPor: f.a.membros.gerente.memberId, despesaId: d.id };
      expect(await pgCode(db.insert(vales).values({ ...base, despesaId: undefined as never }))).toBe('23502');
      expect(await pgCode(db.insert(vales).values({ ...base, valorCentavos: 0 }))).toBe('23514');
      expect(await pgCode(db.insert(vales).values({ ...base, canceladoEm: new Date() }))).toBe('23514');
      expect(await db.insert(vales).values(base).returning()).toHaveLength(1);
      expect(await pgCode(db.delete(vales))).toBe('42501');
    }));

  it('acerto confere pago e saldo devedor; sem DELETE', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      expect(await db.insert(acertosComissao).values(acerto(f.a)).returning()).toHaveLength(1);
      expect(await pgCode(db.insert(acertosComissao).values(acerto(f.a, { pagoCentavos: 100 })))).toBe('23514');
      expect(await pgCode(db.insert(acertosComissao).values(acerto(f.a, { saldoDevedorCentavos: 0 })))).toBe('23514');
      const d = await despesa(db, f.a);
      const pagou = { comissoesCentavos: 50000, valesCentavos: 10000, saldoAnteriorCentavos: 5000, pagoCentavos: 35000, saldoDevedorCentavos: 0 };
      expect(await pgCode(db.insert(acertosComissao).values(acerto(f.a, pagou)))).toBe('23514');
      expect(await pgCode(db.insert(acertosComissao).values(acerto(f.a, { despesaId: d.id })))).toBe('23514');
      expect(
        await db
          .insert(acertosComissao)
          .values(acerto(f.a, { comissoesCentavos: 50000, valesCentavos: 10000, saldoAnteriorCentavos: 5000, pagoCentavos: 35000, saldoDevedorCentavos: 0, despesaId: d.id }))
          .returning(),
      ).toHaveLength(1);
      expect(await pgCode(db.delete(acertosComissao))).toBe('42501');
    }));
});
