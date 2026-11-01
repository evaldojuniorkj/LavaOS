import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Perfil, TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { caixas, ordensServico, pagamentos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { abrirCaixaAction, estornarPagamentoAction, reabrirCaixaAction } from '@/modules/caixa/caixa.actions';
import { caixaAbertoQualquer, caixaDoDia, pagamentosDaOs, resumoDoCaixa } from '@/modules/caixa/caixa.repo';
import { abrirCaixa, estornarPagamento, fecharCaixa, reabrirCaixa, receber } from '@/modules/caixa/caixa.service';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import type { TenantFixture } from '../helpers/fixtures';
import { testUrls, withTestDatabase } from '../helpers/db';
import { criarOs, semearVeiculo, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const ctxDe = (t: TenantFixture, perfil: Perfil) => ({ tenantId: t.tenantId, userId: t.membros[perfil].userId, memberId: t.membros[perfil].memberId, perfil, sessionId: 'x' }) as TenantContext;
type C = { db: Database; f: AuthFixtures; rec: TenantContext; ger: TenantContext; osId: string; os: (status?: Parameters<typeof criarOs>[1]['status']) => Promise<string> };
const run = (fn: (c: C) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const os = async (status?: Parameters<typeof criarOs>[1]['status']) => (await criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId, status })).id;
    await fn({ db, f, rec: ctxDe(f.a, 'recepcao'), ger: ctxDe(f.a, 'gerente'), osId: await os(), os });
  });

const ontem = new Date(Date.now() - 24 * 3600_000);
const ddmm = (d: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(d);
const caixa = async (db: Database, id: string) => (await db.select().from(caixas).where(eq(caixas.id, id)))[0];

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('caixa', () => {
  it('abrir → receber Pix + dinheiro → fechar com o contado certo: diferença 0', () =>
    run(async ({ db, rec, osId }) => {
      const aberto = await abrirCaixa(rec, { trocoInicialCentavos: 10000 }, db);
      expect(aberto.caixa).toMatchObject({ status: 'aberto', trocoInicialCentavos: 10000, dinheiroContadoCentavos: null });
      expect(await receber(rec, { osId, forma: 'pix', valorCentavos: 3000 }, db)).toMatchObject({ saldoCentavos: 2000 });
      expect(await receber(rec, { osId, forma: 'dinheiro', valorCentavos: 2000 }, db)).toMatchObject({ saldoCentavos: 0 });
      const r = await resumoDoCaixa(rec, aberto.caixa.id, db);
      expect(r).toMatchObject({ porForma: { dinheiro: 2000, pix: 3000, debito: 0, credito: 0 }, esperadoDinheiro: 12000 });
      expect(r!.pagamentos.map((p) => [p.forma, p.osNumero, p.recebidoPor])).toEqual([['pix', 1, 'recepcao'], ['dinheiro', 1, 'recepcao']]);
      const fechado = await fecharCaixa(rec, { caixaId: aberto.caixa.id, dinheiroContadoCentavos: 12000 }, db);
      expect(fechado.caixa).toMatchObject({ status: 'fechado', dinheiroContadoCentavos: 12000, diferencaCentavos: 0, fechadoPor: rec.memberId });
      await expect(fecharCaixa(rec, { caixaId: aberto.caixa.id, dinheiroContadoCentavos: 12000 }, db)).rejects.toMatchObject({ code: 'CAIXA_FECHADO' });
    }));

  it('fechar com dinheiro faltando grava diferença negativa', () =>
    run(async ({ db, rec, osId }) => {
      const { caixa: c } = await abrirCaixa(rec, { trocoInicialCentavos: 10000 }, db);
      await receber(rec, { osId, forma: 'dinheiro', valorCentavos: 5000 }, db);
      expect((await fecharCaixa(rec, { caixaId: c.id, dinheiroContadoCentavos: 14500 }, db)).caixa).toMatchObject({ diferencaCentavos: -500 });
    }));

  it('receber sem caixa aberto é recusado', () =>
    run(async ({ db, rec, osId }) => {
      await expect(receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db)).rejects.toMatchObject({ code: 'SEM_CAIXA', message: 'Abra o caixa antes de receber.' });
    }));

  it('caixa de ontem aberto bloqueia receber e abrir o de hoje até ser fechado', () =>
    run(async ({ db, rec, ger, osId }) => {
      const { caixa: velho } = await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db, ontem);
      const msg = `Feche o caixa de ${ddmm(ontem)} antes.`;
      await expect(receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db)).rejects.toMatchObject({ code: 'CAIXA_DE_OUTRO_DIA', message: msg });
      await expect(abrirCaixa(rec, { trocoInicialCentavos: 0 }, db)).rejects.toMatchObject({ code: 'CAIXA_DE_OUTRO_DIA', message: msg });
      expect(await caixaDoDia(rec, new Date(), db)).toBeNull();
      expect((await caixaAbertoQualquer(rec, db))?.id).toBe(velho.id);
      await fecharCaixa(rec, { caixaId: velho.id, dinheiroContadoCentavos: 0 }, db);
      await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      expect(await receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db)).toMatchObject({ saldoCentavos: 4000 });
      // reabrir só o de hoje
      await expect(reabrirCaixa(ger, { caixaId: velho.id }, db)).rejects.toMatchObject({ code: 'CAIXA_DE_OUTRO_DIA' });
    }));

  it('abrir de novo: já aberto, ou fechado hoje pede reabrir', () =>
    run(async ({ db, rec }) => {
      const { caixa: c } = await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      await expect(abrirCaixa(rec, { trocoInicialCentavos: 0 }, db)).rejects.toMatchObject({ code: 'CAIXA_ABERTO', message: 'O caixa de hoje já está aberto.' });
      await fecharCaixa(rec, { caixaId: c.id, dinheiroContadoCentavos: 0 }, db);
      await expect(abrirCaixa(rec, { trocoInicialCentavos: 0 }, db)).rejects.toMatchObject({ code: 'CAIXA_FECHADO', message: 'O caixa de hoje já foi fechado. Reabra o caixa para continuar.' });
    }));

  it('receber acima do total, em OS cancelada ou entregue é recusado', () =>
    run(async ({ db, rec, osId, os }) => {
      await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      await receber(rec, { osId, forma: 'pix', valorCentavos: 3000 }, db);
      await expect(receber(rec, { osId, forma: 'pix', valorCentavos: 2001 }, db)).rejects.toMatchObject({ code: 'ACIMA_DO_SALDO', message: 'Falta receber só R$ 20,00.' });
      await receber(rec, { osId, forma: 'pix', valorCentavos: 2000 }, db);
      await expect(receber(rec, { osId, forma: 'pix', valorCentavos: 1 }, db)).rejects.toMatchObject({ code: 'ACIMA_DO_SALDO', message: 'Essa OS já está quitada.' });
      await expect(receber(rec, { osId: await os('cancelada'), forma: 'pix', valorCentavos: 100 }, db)).rejects.toMatchObject({ code: 'OS_ENCERRADA', message: 'OS cancelada não recebe pagamento.' });
      await expect(receber(rec, { osId: await os('entregue'), forma: 'pix', valorCentavos: 100 }, db)).rejects.toMatchObject({ code: 'OS_ENCERRADA', message: 'OS entregue não recebe pagamento.' });
      expect(await db.select().from(pagamentos)).toHaveLength(2);
    }));

  it('estorno: recepção negada; gerente estorna com motivo e libera o saldo; OS entregue recusa', () =>
    run(async ({ db, f, rec, ger, osId }) => {
      await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      const { pagamentoId } = await receber(rec, { osId, forma: 'dinheiro', valorCentavos: 5000 }, db);
      req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await estornarPagamentoAction({ pagamentoId, motivo: 'errado' })).toEqual({ ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' });
      warn.mockRestore();
      req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
      expect(await estornarPagamentoAction({ pagamentoId, motivo: '' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { motivo: expect.any(Array) } });
      expect(await estornarPagamentoAction({ pagamentoId, motivo: 'valor errado' })).toEqual({ ok: true, data: { saldoCentavos: 5000 } });
      expect(await estornarPagamentoAction({ pagamentoId, motivo: 'de novo' })).toMatchObject({ ok: false, code: 'JA_ESTORNADO' });
      expect((await pagamentosDaOs(rec, osId, db))[0]).toMatchObject({ estornadoPor: ger.memberId, motivoEstorno: 'valor errado' });
      expect(await receber(rec, { osId, forma: 'pix', valorCentavos: 5000 }, db)).toMatchObject({ saldoCentavos: 0 });

      const pix = (await pagamentosDaOs(rec, osId, db)).find((p) => !p.estornadoEm)!;
      await db.update(ordensServico).set({ status: 'entregue' });
      await expect(estornarPagamento(ger, { pagamentoId: pix.id, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'OS_ENCERRADA', message: 'Reabra a OS antes de estornar.' });
    }));

  it('estorno de pagamento de caixa já fechado é recusado', () =>
    run(async ({ db, rec, ger, osId }) => {
      const { caixa: c } = await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db, ontem);
      const [p] = await db.insert(pagamentos).values({ tenantId: rec.tenantId, osId, caixaId: c.id, forma: 'pix', valorCentavos: 1000, recebidoPor: rec.memberId }).returning();
      await fecharCaixa(rec, { caixaId: c.id, dinheiroContadoCentavos: 0 }, db);
      await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      await expect(estornarPagamento(ger, { pagamentoId: p.id, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'CAIXA_FECHADO', message: 'Só dá para estornar pagamento do caixa aberto de hoje.' });
    }));

  it('reabrir: recepção negada; gerente reabre, contado e diferença voltam a null e dá para receber de novo', () =>
    run(async ({ db, f, rec, osId }) => {
      const { caixa: c } = await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      await fecharCaixa(rec, { caixaId: c.id, dinheiroContadoCentavos: 300 }, db);
      await expect(receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db)).rejects.toMatchObject({ code: 'SEM_CAIXA' });
      req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await reabrirCaixaAction({ caixaId: c.id })).toMatchObject({ ok: false, code: 'ACESSO_NEGADO' });
      warn.mockRestore();
      req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
      expect(await reabrirCaixaAction({ caixaId: c.id })).toMatchObject({ ok: true, data: { caixa: { status: 'aberto' } } });
      expect(await caixa(db, c.id)).toMatchObject({ status: 'aberto', dinheiroContadoCentavos: null, diferencaCentavos: null, fechadoEm: null, fechadoPor: null });
      expect(await reabrirCaixaAction({ caixaId: c.id })).toMatchObject({ ok: false, code: 'CAIXA_ABERTO' });
      expect(await receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db)).toMatchObject({ saldoCentavos: 4000 });
    }));

  it('action valida estrito: campo extra e valor fora do limite recusados', () =>
    run(async ({ db, f }) => {
      req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
      expect(await abrirCaixaAction({ trocoInicialCentavos: 100, tenantId: f.b.tenantId })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await abrirCaixaAction({ trocoInicialCentavos: -1 })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await abrirCaixaAction({ trocoInicialCentavos: 1.5 })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await db.select().from(caixas)).toHaveLength(0);
      expect(await abrirCaixaAction({ trocoInicialCentavos: 100 })).toMatchObject({ ok: true, data: { caixa: { trocoInicialCentavos: 100 } } });
    }));

  it('outro tenant não enxerga caixa, OS nem pagamento', () =>
    run(async ({ db, f, rec, osId }) => {
      const { caixa: c } = await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
      const { pagamentoId } = await receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db);
      const b = ctxDe(f.b, 'gerente');
      expect(await caixaDoDia(b, new Date(), db)).toBeNull();
      expect(await caixaAbertoQualquer(b, db)).toBeNull();
      expect(await resumoDoCaixa(b, c.id, db)).toBeNull();
      expect(await pagamentosDaOs(b, osId, db)).toEqual([]);
      await abrirCaixa(b, { trocoInicialCentavos: 0 }, db); // o de A não impede o de B
      await expect(receber(b, { osId, forma: 'pix', valorCentavos: 1000 }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      await expect(estornarPagamento(b, { pagamentoId, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      await expect(fecharCaixa(b, { caixaId: c.id, dinheiroContadoCentavos: 0 }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      await expect(reabrirCaixa(b, { caixaId: c.id }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      expect((await caixa(db, c.id)).status).toBe('aberto');
    }));

  it('eventos só com ids e tipo; recusa (rollback) não publica', () =>
    run(async ({ db, rec, ger, osId }) => {
      const raw = new Client({ connectionString: testUrls.app });
      await raw.connect();
      const recebidos: string[] = [];
      raw.on('notification', (n) => recebidos.push(n.payload!));
      await raw.query('listen lavaos_eventos');
      try {
        const { caixa: c } = await abrirCaixa(rec, { trocoInicialCentavos: 0 }, db);
        await expect(receber(rec, { osId, forma: 'pix', valorCentavos: 9999 }, db)).rejects.toMatchObject({ code: 'ACIMA_DO_SALDO' });
        const { pagamentoId } = await receber(rec, { osId, forma: 'pix', valorCentavos: 1000 }, db);
        await estornarPagamento(ger, { pagamentoId, motivo: 'x' }, db);
        await fecharCaixa(rec, { caixaId: c.id, dinheiroContadoCentavos: 0 }, db);
        await reabrirCaixa(ger, { caixaId: c.id }, db);
        for (let i = 0; recebidos.length < 5 && i < 100; i++) await new Promise((r) => setTimeout(r, 20));
        const t = rec.tenantId;
        expect(recebidos.map((p) => JSON.parse(p))).toEqual([
          { tenantId: t, tipo: 'caixa' },
          { tenantId: t, osId, tipo: 'pagamento' },
          { tenantId: t, osId, tipo: 'pagamento' },
          { tenantId: t, tipo: 'caixa' },
          { tenantId: t, tipo: 'caixa' },
        ]);
        expect(recebidos.join()).not.toMatch(/centavos|1000|nome/i);
      } finally {
        await raw.end();
      }
    }));
});
