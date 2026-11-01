import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { acertosComissao, comissoes, ordensServico, osItens, portes, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import type { TenantContext } from '@/lib/auth/types';
import { basesDosItens, comissaoDoItem } from '@/modules/comissoes/comissoes.rules';
import { ComissoesError } from '@/modules/comissoes/comissoes.service';
import { atribuirResponsavel, transitarOs } from '@/modules/ordens/ordens.service';
import '../helpers/auth'; // env do runtime (getDatabase, publicar): no CI não há .env.local
import { withTestDatabase } from '../helpers/db';
import { createFoundationFixtures, type FoundationFixtures } from '../helpers/fixtures';
import { criarMembro, criarOs, pagar, semearVeiculo } from '../helpers/ordens';

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

type T = FoundationFixtures['a'];
const ctxDe = (t: T, perfil: 'gerente' | 'recepcao') =>
  ({ tenantId: t.tenantId, userId: t.membros[perfil].userId, memberId: t.membros[perfil].memberId, perfil, sessionId: 'x' }) as TenantContext;

// R$ 50,00 e R$ 30,00 a 33,33 % e R$ 20,00 com fixo de R$ 7,00; desconto de R$ 7,01 deixa sobra de 2 centavos no rateio
const ITENS = [
  { valor: 5000, tipo: 'percentual', comissao: 3333 },
  { valor: 3000, tipo: 'percentual', comissao: 3333 },
  { valor: 2000, tipo: 'fixo', comissao: 700 },
] as const;

/** OS pronta com os itens dados, desconto aplicado e quitada (entregar exige quitação). */
async function osPronta(db: Database, t: T, responsavelId: string, itens: readonly { valor: number; tipo: 'percentual' | 'fixo'; comissao: number }[] = ITENS, desconto = 701) {
  const v = await semearVeiculo(db, t.tenantId);
  const [porte] = await db.select().from(portes).where(eq(portes.tenantId, t.tenantId));
  const [servico] = await db.select().from(servicos).where(eq(servicos.tenantId, t.tenantId));
  const os = await criarOs(db, { tenantId: t.tenantId, veiculoId: v.id, abertaPor: t.membros.recepcao.memberId, status: 'pronto', responsavelId });
  const subtotal = itens.reduce((a, i) => a + i.valor, 0);
  const total = Math.max(0, subtotal - desconto);
  await db.update(ordensServico).set({ subtotalCentavos: subtotal, descontoCentavos: desconto, totalCentavos: total }).where(eq(ordensServico.id, os.id));
  const linhas = [];
  for (const [k, i] of itens.entries()) {
    // createdAt distinto: a ordem dos itens (desempate do rateio) fica determinística
    const [it] = await db
      .insert(osItens)
      .values({ tenantId: t.tenantId, osId: os.id, servicoId: servico.id, porteId: porte.id, nomeServico: `S${k}`, valorCentavos: i.valor, comissaoTipo: i.tipo, comissaoValor: i.comissao, createdAt: new Date(Date.now() + k) })
      .returning();
    linhas.push(it);
  }
  if (total > 0) await pagar(db, { tenantId: t.tenantId, osId: os.id, recebidoPor: t.membros.recepcao.memberId, valorCentavos: total });
  return { os, itens: linhas };
}

const doBanco = (db: Database, osId: string) =>
  db
    .select({ osItemId: comissoes.osItemId, membroId: comissoes.membroId, baseCentavos: comissoes.baseCentavos, valorCentavos: comissoes.valorCentavos, acertoId: comissoes.acertoId })
    .from(comissoes)
    .innerJoin(osItens, eq(osItens.id, comissoes.osItemId))
    .where(eq(comissoes.osId, osId))
    .orderBy(asc(osItens.createdAt));

const entregar = (ctx: TenantContext, db: Database, osId: string) => transitarOs(ctx, { osId, esperado: 'pronto', para: 'entregue' }, db);
const reabrir = (ctx: TenantContext, db: Database, osId: string) => transitarOs(ctx, { osId, esperado: 'entregue', para: 'pronto', motivo: 'cobrou errado' }, db);

describe('geração de comissões na entrega', () => {
  it('entregar gera uma comissão por item para o responsável, com bases rateadas e valores das regras', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const lav = f.a.membros.lavador.memberId;
      const { os, itens } = await osPronta(db, f.a, lav);
      await entregar(ctxDe(f.a, 'recepcao'), db, os.id);

      const bases = basesDosItens(ITENS.map((i) => i.valor), 701, 0);
      expect(bases).toEqual([4651, 2789, 1859]); // 9299 no total; a sobra de 2 centavos foi para o maior
      expect(ITENS.map((i, k) => comissaoDoItem(bases[k], i.tipo, i.comissao))).toEqual([1550, 930, 700]);
      expect(await doBanco(db, os.id)).toEqual([
        { osItemId: itens[0].id, membroId: lav, baseCentavos: 4651, valorCentavos: 1550, acertoId: null },
        { osItemId: itens[1].id, membroId: lav, baseCentavos: 2789, valorCentavos: 930, acertoId: null },
        { osItemId: itens[2].id, membroId: lav, baseCentavos: 1859, valorCentavos: 700, acertoId: null },
      ]);
    }));

  it('OS de total zero com item fixo gera o fixo; o percentual fica zero', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const lav = f.a.membros.lavador.memberId;
      const { os } = await osPronta(db, f.a, lav, [ITENS[0], ITENS[2]], 7000);
      await entregar(ctxDe(f.a, 'recepcao'), db, os.id);
      expect((await doBanco(db, os.id)).map((c) => [c.baseCentavos, c.valorCentavos])).toEqual([[0, 0], [0, 700]]);
    }));

  it('reabrir apaga as pendentes; entregar de novo regera sem duplicar, para o responsável da nova entrega', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const lav = f.a.membros.lavador.memberId;
      const { os } = await osPronta(db, f.a, lav);
      const ger = ctxDe(f.a, 'gerente');
      await entregar(ger, db, os.id);
      await reabrir(ger, db, os.id);
      expect(await doBanco(db, os.id)).toEqual([]);

      await entregar(ger, db, os.id);
      expect((await doBanco(db, os.id)).map((c) => [c.membroId, c.valorCentavos])).toEqual([[lav, 1550], [lav, 930], [lav, 700]]);

      const outro = await criarMembro(db, f.a.tenantId, 'Outro');
      await reabrir(ger, db, os.id);
      await atribuirResponsavel(ger, { osId: os.id, membroId: outro.id }, db);
      await entregar(ger, db, os.id);
      expect((await doBanco(db, os.id)).map((c) => [c.membroId, c.valorCentavos])).toEqual([[outro.id, 1550], [outro.id, 930], [outro.id, 700]]);
    }));

  it('reabrir com comissão já em acerto é recusado e nada muda', () =>
    withTestDatabase(async (db) => {
      const f = await createFoundationFixtures(db);
      const lav = f.a.membros.lavador.memberId;
      const { os } = await osPronta(db, f.a, lav);
      const ger = ctxDe(f.a, 'gerente');
      await entregar(ger, db, os.id);
      const [a] = await db
        .insert(acertosComissao)
        .values({ tenantId: f.a.tenantId, membroId: lav, periodoInicio: '2026-10-01', periodoFim: '2026-10-30', comissoesCentavos: 0, valesCentavos: 0, saldoAnteriorCentavos: 0, pagoCentavos: 0, saldoDevedorCentavos: 0, pagoPor: ger.memberId, pagoEm: new Date('2026-10-30T15:00:00Z') })
        .returning();
      const [primeira] = await doBanco(db, os.id);
      await db.update(comissoes).set({ acertoId: a.id }).where(eq(comissoes.osItemId, primeira.osItemId));
      const antes = await doBanco(db, os.id);

      const erro = await reabrir(ger, db, os.id).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(ComissoesError);
      expect(erro).toMatchObject({ code: 'COMISSAO_PAGA', message: 'Comissão já paga no acerto de 30/10.' });
      expect(await doBanco(db, os.id)).toEqual(antes);
      expect((await db.select().from(ordensServico).where(eq(ordensServico.id, os.id)))[0]).toMatchObject({ status: 'entregue', entregueEm: expect.any(Date) });
    }));
});
