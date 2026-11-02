import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Perfil, TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { acertosComissao, categoriasDespesa, comissoes, despesas, membros, osItens, portes, servicos, vales } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { abrirCaixa } from '@/modules/caixa/caixa.service';
import { resumoDoCaixa } from '@/modules/caixa/caixa.repo';
import { cancelarValeAction, lancarValeAction, pagarAcertoAction } from '@/modules/comissoes/comissoes.actions';
import { acertosDoMembro, detalheAcerto, pendentesPorMembro } from '@/modules/comissoes/comissoes.repo';
import { cancelarVale, lancarVale, pagarAcerto, previaAcerto } from '@/modules/comissoes/comissoes.service';
import { listarDespesas } from '@/modules/despesas/despesas.repo';
import { cancelarDespesa, lancarDespesa } from '@/modules/despesas/despesas.service';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import type { TenantFixture } from '../helpers/fixtures';
import { withTestDatabase } from '../helpers/db';
import { criarMembro, criarOs, esperarNoLock, semearVeiculo, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

const dia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const hoje = dia(new Date());
const ontemEm = new Date(Date.now() - 24 * 3600_000);
const ontem = dia(ontemEm);

const ctxDe = (t: TenantFixture, perfil: Perfil) => ({ tenantId: t.tenantId, userId: t.membros[perfil].userId, memberId: t.membros[perfil].memberId, perfil, sessionId: 'x' }) as TenantContext;
type C = { db: Database; f: AuthFixtures; ger: TenantContext; lav: string; comissao: (valor: number, membroId?: string, entregueEm?: Date) => Promise<string> };

/** Comissão semeada direto numa OS entregue (a geração na entrega é testada em comissoes-geracao). */
const run = (fn: (c: C) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const t = f.a.tenantId;
    const v = await semearVeiculo(db, t);
    const [porte] = await db.select().from(portes).where(eq(portes.tenantId, t));
    const [servico] = await db.select().from(servicos).where(eq(servicos.tenantId, t));
    const lav = f.a.membros.lavador.memberId;
    const comissao = async (valor: number, membroId = lav, entregueEm = new Date()) => {
      const os = await criarOs(db, { tenantId: t, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId, status: 'entregue', responsavelId: membroId, entregueEm });
      const [it] = await db.insert(osItens).values({ tenantId: t, osId: os.id, servicoId: servico.id, porteId: porte.id, nomeServico: 'Lavagem', valorCentavos: 5000, comissaoTipo: 'fixo', comissaoValor: valor }).returning();
      await db.insert(comissoes).values({ tenantId: t, osId: os.id, osItemId: it.id, membroId, baseCentavos: 5000, valorCentavos: valor, geradaEm: entregueEm });
      return os.id;
    };
    await fn({ db, f, ger: ctxDe(f.a, 'gerente'), lav, comissao });
  });

const despesasDe = (db: Database, categoria: string) =>
  db
    .select({ valor: despesas.valorCentavos, cancelada: despesas.canceladaEm, caixaId: despesas.caixaId })
    .from(despesas)
    .innerJoin(categoriasDespesa, eq(categoriasDespesa.id, despesas.categoriaId))
    .where(eq(categoriasDespesa.nome, categoria));

describe('vales e acerto', () => {
  it('vale maior que a comissão: paga R$ 0 e fica devendo; o próximo acerto desconta o saldo', () =>
    run(async ({ db, ger, lav, comissao }) => {
      await comissao(20000);
      await lancarVale(ger, { membroId: lav, valorCentavos: 30000 }, db);
      expect(await previaAcerto(ger, { membroId: lav, ate: hoje }, db)).toEqual({ comissoesCentavos: 20000, valesCentavos: 30000, saldoAnteriorCentavos: 0, pagoCentavos: 0, saldoDevedorCentavos: 10000 });
      const a1 = await pagarAcerto(ger, { membroId: lav, ate: hoje }, db);
      expect(a1).toMatchObject({ pagoCentavos: 0, saldoDevedorCentavos: 10000, despesaId: null, periodoFim: hoje });
      expect(await despesasDe(db, 'Comissões')).toEqual([]);
      expect(await pendentesPorMembro(ger, hoje, db)).toEqual([expect.objectContaining({ membroId: lav, comissoesCentavos: 0, valesCentavos: 0, saldoAnteriorCentavos: 10000, saldoDevedorCentavos: 10000 })]);

      await comissao(50000);
      const a2 = await pagarAcerto(ger, { membroId: lav, ate: hoje }, db);
      expect(a2).toMatchObject({ comissoesCentavos: 50000, valesCentavos: 0, saldoAnteriorCentavos: 10000, pagoCentavos: 40000, saldoDevedorCentavos: 0, despesaId: expect.any(String) });
      expect(await despesasDe(db, 'Comissões')).toEqual([expect.objectContaining({ valor: 40000, caixaId: null })]);
      expect((await acertosDoMembro(ger, lav, db)).map((a) => a.id)).toEqual([a2.id, a1.id]);
      expect(await pendentesPorMembro(ger, hoje, db)).toEqual([]);
      await expect(pagarAcerto(ger, { membroId: lav, ate: hoje }, db)).rejects.toMatchObject({ code: 'SEM_PENDENCIA' });
    }));

  it('vale igual zera sem despesa; vale menor paga a diferença numa despesa "Comissões"', () =>
    run(async ({ db, ger, lav, comissao }) => {
      await comissao(20000);
      await lancarVale(ger, { membroId: lav, valorCentavos: 20000 }, db);
      expect(await pagarAcerto(ger, { membroId: lav, ate: hoje }, db)).toMatchObject({ pagoCentavos: 0, saldoDevedorCentavos: 0, despesaId: null });
      await comissao(20000);
      await lancarVale(ger, { membroId: lav, valorCentavos: 5000 }, db);
      expect(await pagarAcerto(ger, { membroId: lav, ate: hoje }, db)).toMatchObject({ comissoesCentavos: 20000, valesCentavos: 5000, pagoCentavos: 15000, saldoDevedorCentavos: 0 });
      expect((await despesasDe(db, 'Comissões')).map((d) => d.valor)).toEqual([15000]);
    }));

  it('soma das despesas (vales + acertos) = comissões geradas, sem nada em dobro', () =>
    run(async ({ db, ger, lav, comissao }) => {
      for (const v of [1550, 930, 700, 12345]) await comissao(v);
      await lancarVale(ger, { membroId: lav, valorCentavos: 3000 }, db);
      await lancarVale(ger, { membroId: lav, valorCentavos: 2000 }, db);
      await pagarAcerto(ger, { membroId: lav, ate: hoje }, db);
      const todas = await db.select({ v: despesas.valorCentavos }).from(despesas);
      expect(todas.reduce((s, d) => s + d.v, 0)).toBe(1550 + 930 + 700 + 12345);
      expect((await db.select().from(vales)).every((v) => v.acertoId)).toBe(true);
      expect((await db.select().from(comissoes)).every((c) => c.acertoId)).toBe(true);
    }));

  it('despesa de vale ou de acerto não cancela pela tela de despesas e vem marcada', () =>
    run(async ({ db, ger, lav, comissao }) => {
      await comissao(20000);
      const v = await lancarVale(ger, { membroId: lav, valorCentavos: 5000 }, db);
      await expect(cancelarDespesa(ger, { despesaId: v.despesaId, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'DE_COMISSAO', message: 'Cancele pelo vale em Comissões.' });
      const a = await pagarAcerto(ger, { membroId: lav, ate: hoje }, db);
      await expect(cancelarDespesa(ger, { despesaId: a.despesaId!, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'DE_COMISSAO', message: 'Despesa de acerto de comissão não pode ser cancelada.' });
      const [outros] = await db.select({ id: categoriasDespesa.id }).from(categoriasDespesa).where(and(eq(categoriasDespesa.tenantId, ger.tenantId), eq(categoriasDespesa.nome, 'Outros')));
      await lancarDespesa(ger, { categoriaId: outros.id, descricao: 'Sabão', valorCentavos: 100, pagoEm: hoje }, db);
      const lista = await listarDespesas(ger, { de: hoje, ate: hoje }, db);
      expect(lista.map((d) => [d.descricao, d.deComissao]).sort()).toEqual([['Acerto de lavador', true], ['Sabão', false], ['Vale de lavador', true]]);
      expect((await despesasDe(db, 'Vales'))[0].cancelada).toBeNull();
    }));

  it('vale e acerto com dinheiro do caixa reduzem o esperado', () =>
    run(async ({ db, ger, lav, comissao }) => {
      const { caixa } = await abrirCaixa(ger, { trocoInicialCentavos: 50000 }, db);
      await comissao(20000);
      const vale = await lancarVale(ger, { membroId: lav, valorCentavos: 3000, doCaixa: true }, db);
      expect(vale).toMatchObject({ membroId: lav, valorCentavos: 3000, acertoId: null });
      expect(await resumoDoCaixa(ger, caixa.id, db)).toMatchObject({ esperadoDinheiro: 47000 });
      await pagarAcerto(ger, { membroId: lav, ate: hoje, doCaixa: true }, db);
      expect(await resumoDoCaixa(ger, caixa.id, db)).toMatchObject({ esperadoDinheiro: 30000 });
      expect((await despesasDe(db, 'Vales'))[0]).toMatchObject({ valor: 3000, caixaId: caixa.id });
    }));

  it('cancelar vale pendente cancela a despesa; vale já acertado não cancela', () =>
    run(async ({ db, ger, lav, comissao }) => {
      const v1 = await lancarVale(ger, { membroId: lav, valorCentavos: 3000 }, db);
      expect(await cancelarVale(ger, { valeId: v1.id, motivo: 'lançou errado' }, db)).toMatchObject({ canceladoEm: expect.any(Date) });
      expect((await despesasDe(db, 'Vales'))[0].cancelada).toEqual(expect.any(Date));
      await expect(cancelarVale(ger, { valeId: v1.id, motivo: 'de novo' }, db)).rejects.toMatchObject({ code: 'JA_CANCELADO' });

      await comissao(10000);
      const v2 = await lancarVale(ger, { membroId: lav, valorCentavos: 4000 }, db);
      expect(await previaAcerto(ger, { membroId: lav, ate: hoje }, db)).toMatchObject({ valesCentavos: 4000 }); // o cancelado não entra
      await pagarAcerto(ger, { membroId: lav, ate: hoje }, db);
      await expect(cancelarVale(ger, { valeId: v2.id, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'VALE_EM_ACERTO' });
      expect((await db.select().from(despesas).where(eq(despesas.id, v2.despesaId)))[0].canceladaEm).toBeNull();
    }));

  it('comissão de OS entregue depois de `ate` fica para o próximo acerto; detalhe lista OS, itens e vales', () =>
    run(async ({ db, ger, lav, comissao }) => {
      const osOntem = await comissao(1000, lav, ontemEm);
      await comissao(2000);
      const a = await pagarAcerto(ger, { membroId: lav, ate: ontem }, db);
      expect(a).toMatchObject({ comissoesCentavos: 1000, periodoInicio: ontem, periodoFim: ontem });
      expect((await previaAcerto(ger, { membroId: lav, ate: hoje }, db)).comissoesCentavos).toBe(2000);
      await expect(previaAcerto(ger, { membroId: lav, ate: dia(new Date(Date.now() + 48 * 3600_000)) }, db)).rejects.toMatchObject({ code: 'VALIDACAO' });

      const d = await detalheAcerto(ger, a.id, db);
      expect(d).toMatchObject({ acerto: { id: a.id, membroNome: expect.any(String) }, comissoes: [{ osId: osOntem, nomeServico: 'Lavagem', valorCentavos: 1000 }], vales: [] });
    }));

  it('dois acertos simultâneos do mesmo membro: um passa, o outro não acha pendências', () =>
    run(async ({ db, ger, lav, comissao }) => {
      await comissao(10000);
      await lancarVale(ger, { membroId: lav, valorCentavos: 1000 }, db);
      const travado = Promise.withResolvers<void>();
      const soltar = Promise.withResolvers<void>();
      const trava = db.transaction(async (tx) => {
        await tx.select({ id: membros.id }).from(membros).where(eq(membros.id, lav)).for('update');
        travado.resolve();
        await soltar.promise;
      });
      await travado.promise;
      const acertar = () => pagarAcerto(ger, { membroId: lav, ate: hoje }, db).then((v) => ({ ok: true, v }) as const, (e: unknown) => ({ ok: false, e }) as const);
      const r1 = acertar();
      await esperarNoLock(db, 1);
      const r2 = acertar();
      await esperarNoLock(db, 2);
      soltar.resolve();
      await trava;
      const rs = await Promise.all([r1, r2]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      expect(rs.find((r) => !r.ok)).toMatchObject({ e: { code: 'SEM_PENDENCIA' } });
      expect(await db.select().from(acertosComissao)).toHaveLength(1);
      expect((await despesasDe(db, 'Comissões')).map((d) => d.valor)).toEqual([9000]);
    }));

  it('desativado com pendência aparece e acerta, mas não recebe vale novo; outro tenant não vê nem mexe', () =>
    run(async ({ db, f, ger, comissao }) => {
      const ex = await criarMembro(db, f.a.tenantId, 'Ex-lavador');
      await comissao(5000, ex.id);
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, ex.id));
      expect(await pendentesPorMembro(ger, hoje, db)).toEqual([expect.objectContaining({ membroId: ex.id, nome: 'Ex-lavador', ativo: false, pagoCentavos: 5000 })]);
      await expect(lancarVale(ger, { membroId: ex.id, valorCentavos: 100 }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });

      const b = ctxDe(f.b, 'gerente');
      expect(await pendentesPorMembro(b, hoje, db)).toEqual([]);
      await expect(lancarVale(b, { membroId: f.a.membros.lavador.memberId, valorCentavos: 100 }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      await expect(pagarAcerto(b, { membroId: ex.id, ate: hoje }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      const a = await pagarAcerto(ger, { membroId: ex.id, ate: hoje }, db);
      expect(await detalheAcerto(b, a.id, db)).toBeNull();
      expect(await acertosDoMembro(b, ex.id, db)).toEqual([]);
      const v = await lancarVale(ger, { membroId: f.a.membros.lavador.memberId, valorCentavos: 100 }, db);
      await expect(cancelarVale(b, { valeId: v.id, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      expect(await db.select().from(despesas).where(and(eq(despesas.tenantId, f.b.tenantId)))).toEqual([]);
    }));

  it('recepção negada; actions validam estrito', () =>
    run(async ({ db, f, lav }) => {
      req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await lancarValeAction({ membroId: lav, valorCentavos: 100 })).toEqual({ ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' });
      expect(await pagarAcertoAction({ membroId: lav, ate: hoje })).toMatchObject({ ok: false, code: 'ACESSO_NEGADO' });
      warn.mockRestore();
      req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
      expect(await lancarValeAction({ membroId: lav, valorCentavos: 100, tenantId: f.b.tenantId })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await lancarValeAction({ membroId: lav, valorCentavos: 0 })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { valorCentavos: expect.any(Array) } });
      expect(await pagarAcertoAction({ membroId: lav, ate: '31/10/2026' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { ate: expect.any(Array) } });
      const r = await lancarValeAction({ membroId: lav, valorCentavos: 100, doCaixa: true });
      expect(r).toMatchObject({ ok: false, code: 'SEM_CAIXA' });
      const ok = await lancarValeAction({ membroId: lav, valorCentavos: 100 });
      expect(ok).toMatchObject({ ok: true, data: { valorCentavos: 100 } });
      expect(await cancelarValeAction({ valeId: (ok as { data: { id: string } }).data.id, motivo: '' })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await db.select().from(vales).where(inArray(vales.membroId, [lav]))).toHaveLength(1);
    }));
});
