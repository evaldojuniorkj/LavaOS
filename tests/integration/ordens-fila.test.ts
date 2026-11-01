import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, osItens, pagamentos, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { listarEntreguesHojeAction, listarFilaAction, obterOsAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { listarFila } from '@/modules/ordens/ordens.repo';
import { ERROS_RECARREGAR_FILA } from '@/modules/ordens/ordens.rules';
import { inicioDoDia } from '@/modules/painel/painel.rules';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarOs, pagar, semearVeiculo, sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const run = (fn: (c: { db: Database; f: AuthFixtures; veiculoId: string; servicoId: string; os: (i?: Partial<Parameters<typeof criarOs>[1]>) => ReturnType<typeof criarOs> }) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const [s] = await db.select().from(servicos).where(eq(servicos.tenantId, f.a.tenantId));
    const os: Parameters<typeof fn>[0]['os'] = async (i = {}) => {
      const o = await criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId, ...i });
      await db.insert(osItens).values({ tenantId: f.a.tenantId, osId: o.id, servicoId: s.id, porteId: v.porteId, nomeServico: 'Lavagem', valorCentavos: 5000, comissaoTipo: 'percentual', comissaoValor: 3000 });
      return o;
    };
    await fn({ db, f, veiculoId: v.id, servicoId: s.id, os });
  });

const como = async (f: AuthFixtures, userId: string) => void (req.headers = await sessaoStaff(f, userId));
const chaves = (v: unknown): string[] =>
  v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : [];
const dados = <T>(r: { ok: boolean; data?: T }) => {
  expect(r.ok).toBe(true);
  return r.data as T;
};

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('leitura da fila', () => {
  it('lavador vê a fila inteira sem nenhum campo monetário (varredura recursiva)', () =>
    run(async ({ db, f, os }) => {
      const a = await os();
      await pagar(db, { tenantId: f.a.tenantId, osId: a.id, recebidoPor: f.a.membros.recepcao.memberId });
      await os({ status: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId });
      req.headers = await sessaoLavador(f);
      const fila = dados(await listarFilaAction());
      expect(fila).toHaveLength(2);
      expect(chaves(fila).filter((k) => /centavos|pago|token|telefone|comissao/i.test(k))).toEqual([]);
      const um = dados(await obterOsAction({ osId: a.id }));
      expect(chaves(um).filter((k) => /centavos|token|telefone|comissao/i.test(k))).toEqual([]);
    }));

  it('gestão vê totais, itens com valor, telefone e o pago (só pagamentos ativos)', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      const semPagamento = await os();
      const rec = f.a.membros.recepcao.memberId;
      await pagar(db, { tenantId: f.a.tenantId, osId: o.id, recebidoPor: rec, valorCentavos: 2000 });
      const estornado = await pagar(db, { tenantId: f.a.tenantId, osId: o.id, recebidoPor: rec, valorCentavos: 1000 });
      await db.update(pagamentos).set({ estornadoEm: new Date(), estornadoPor: rec, motivoEstorno: 'x' }).where(eq(pagamentos.id, estornado.id));
      for (const m of ['dono', 'gerente', 'recepcao'] as const) {
        await como(f, f.a.membros[m].userId);
        expect(dados(await listarFilaAction())).toMatchObject([
          { id: o.id, totalCentavos: 5000, pagoCentavos: 2000, tokenPublico: o.tokenPublico, itens: [{ nome: 'Lavagem', valorCentavos: 5000 }] },
          { id: semPagamento.id, pagoCentavos: 0 },
        ]);
      }
    }));

  it('ordena pelas mais antigas, só status da fila, e usa número constante de consultas', () =>
    run(async ({ db, f, os }) => {
      const t = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min));
      const nova = await os({ status: 'pronto' });
      const velha = await os();
      const meio = await os({ status: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId });
      for (const [o, min] of [[velha, 0], [meio, 5], [nova, 10]] as const) await db.update(ordensServico).set({ entradaEm: t(min) }).where(eq(ordensServico.id, o.id));
      await os({ status: 'entregue' });
      await os({ status: 'cancelada' });
      await como(f, f.a.membros.recepcao.userId);
      expect(dados<{ id: string }[]>(await listarFilaAction()).map((o) => o.id)).toEqual([velha.id, meio.id, nova.id]);

      const ctx = { tenantId: f.a.tenantId, perfil: 'dono' } as Parameters<typeof listarFila>[0];
      const consultas = async () => {
        let n = 0;
        const contador = new Proxy(db, { get: (d, p) => (p === 'select' ? (...a: unknown[]) => (n++, (d.select as (...x: unknown[]) => unknown)(...a)) : Reflect.get(d, p)) });
        await listarFila(ctx, contador);
        return n;
      };
      const tres = await consultas();
      for (const o of [await os(), await os()]) await pagar(db, { tenantId: f.a.tenantId, osId: o.id, recebidoPor: f.a.membros.recepcao.memberId });
      expect(await consultas()).toBe(tres);
    }));

  it('empate em entrada_em desempata por id', () =>
    run(async ({ db, f, os }) => {
      const mesma = new Date(Date.UTC(2026, 0, 1, 12));
      const oss = [await os(), await os(), await os()];
      for (const o of oss) await db.update(ordensServico).set({ entradaEm: mesma }).where(eq(ordensServico.id, o.id));
      await como(f, f.a.membros.recepcao.userId);
      expect(dados<{ id: string }[]>(await listarFilaAction()).map((o) => o.id)).toEqual(oss.map((o) => o.id).sort());
    }));

  it('isolamento de tenant: fila e obterOs', () =>
    run(async ({ db, f, os }) => {
      const a = await os();
      const vB = await semearVeiculo(db, f.b.tenantId);
      await criarOs(db, { tenantId: f.b.tenantId, veiculoId: vB.id, abertaPor: f.b.membros.recepcao.memberId });
      await como(f, f.a.membros.recepcao.userId);
      expect(dados<{ id: string }[]>(await listarFilaAction()).map((o) => o.id)).toEqual([a.id]);
      const [oB] = await db.select().from(ordensServico).where(eq(ordensServico.tenantId, f.b.tenantId));
      expect(await obterOsAction({ osId: oB.id })).toEqual({ ok: true, data: null });
      expect(await obterOsAction({ osId: 'lixo' })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await obterOsAction({ osId: a.id, extra: 1 })).toMatchObject({ ok: false, code: 'VALIDACAO' });
    }));

  it('entregues e canceladas fora da fila, mas obterOs ainda as devolve', () =>
    run(async ({ f, os }) => {
      const e = await os({ status: 'entregue' });
      const c = await os({ status: 'cancelada' });
      req.headers = await sessaoLavador(f);
      expect(dados(await listarFilaAction())).toEqual([]);
      expect(dados(await obterOsAction({ osId: e.id }))).toMatchObject({ status: 'entregue' });
      expect(dados(await obterOsAction({ osId: c.id }))).toMatchObject({ status: 'cancelada' });
    }));

  it('Entregues hoje: só as entregues desde a meia-noite, só do tenant; lavador sem R$', () =>
    run(async ({ db, f, os }) => {
      const hoje = await os({ status: 'entregue', entregueEm: new Date() });
      await pagar(db, { tenantId: f.a.tenantId, osId: hoje.id, recebidoPor: f.a.membros.recepcao.memberId });
      await os({ status: 'entregue', entregueEm: new Date(inicioDoDia(new Date()).getTime() - 60_000) }); // ontem, 23:59
      await os({ status: 'pronto' });
      await os({ status: 'cancelada' });
      const vB = await semearVeiculo(db, f.b.tenantId);
      await criarOs(db, { tenantId: f.b.tenantId, veiculoId: vB.id, abertaPor: f.b.membros.recepcao.memberId, status: 'entregue', entregueEm: new Date() });
      await como(f, f.a.membros.recepcao.userId);
      expect(dados(await listarEntreguesHojeAction())).toMatchObject([{ id: hoje.id, totalCentavos: 5000, pagoCentavos: 5000 }]);
      req.headers = await sessaoLavador(f);
      const lav = dados(await listarEntreguesHojeAction());
      expect(lav).toMatchObject([{ id: hoje.id }]);
      expect(chaves(lav).filter((k) => /centavos|pago|token|telefone|comissao/i.test(k))).toEqual([]);
    }));

  it('ERROS_RECARREGAR_FILA coincide com os códigos que o serviço devolve', () =>
    run(async ({ f, os }) => {
      const codigos = new Set<string>();
      const ver = async (p: Promise<{ ok: boolean; code?: string }>) => void codigos.add((await p).code ?? '');
      await como(f, f.a.membros.recepcao.userId);
      const entregue = await os({ status: 'entregue' });
      await ver(transitarOsAction({ osId: entregue.id, esperado: 'entregue', para: 'em_lavagem' }));
      const aguardando = await os();
      await ver(transitarOsAction({ osId: aguardando.id, esperado: 'pronto', para: 'entregue' }));
      const semPagar = await os({ status: 'pronto', responsavelId: f.a.membros.gerente.memberId });
      await ver(transitarOsAction({ osId: semPagar.id, esperado: 'pronto', para: 'entregue' }));
      const outra = await os({ status: 'em_lavagem', responsavelId: f.a.membros.gerente.memberId });
      req.headers = await sessaoLavador(f);
      await ver(transitarOsAction({ osId: outra.id, esperado: 'em_lavagem', para: 'pronto' }));
      expect([...codigos].sort()).toEqual([...ERROS_RECARREGAR_FILA].sort());
    }));
});
