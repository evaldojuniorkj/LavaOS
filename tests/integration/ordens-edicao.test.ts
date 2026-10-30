import { and, asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, osEventos, osItens, precos, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { ajustarValorAction, editarItensAction } from '@/modules/ordens/ordens.actions';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarOs, semearVeiculo, sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const COMISSAO = { comissaoTipo: 'fixo', comissaoValor: 100 } as const;
/** OS com o item principal "Lavagem" (5000) + catálogo extra: Cera (adicional, 3000) e Polimento (principal, 8000). */
const run = (fn: (c: { db: Database; f: AuthFixtures; osId: string; lavagem: string; cera: string; polimento: string; itemId: string }) => Promise<void>, status: Parameters<typeof criarOs>[1]['status'] = 'aguardando') =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const [lav] = await db.select().from(servicos).where(eq(servicos.tenantId, f.a.tenantId));
    const novo = async (nome: string, adicional: boolean, valor: number) => {
      const [s] = await db.insert(servicos).values({ tenantId: f.a.tenantId, nome, adicional, ...COMISSAO }).returning();
      await db.insert(precos).values({ tenantId: f.a.tenantId, servicoId: s.id, porteId: v.porteId, valorCentavos: valor });
      return s.id;
    };
    const cera = await novo('Cera', true, 3000);
    const polimento = await novo('Polimento', false, 8000);
    const os = await criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId, status });
    const [item] = await db.insert(osItens).values({ tenantId: f.a.tenantId, osId: os.id, servicoId: lav.id, porteId: v.porteId, nomeServico: 'Lavagem', valorCentavos: 5000, comissaoTipo: 'percentual', comissaoValor: 3000 }).returning();
    await fn({ db, f, osId: os.id, lavagem: lav.id, cera, polimento, itemId: item.id });
  });

const como = async (f: AuthFixtures, userId: string) => void (req.headers = await sessaoStaff(f, userId));
const linha = async (db: Database, id: string) => (await db.select().from(ordensServico).where(eq(ordensServico.id, id)))[0];
const itens = (db: Database, osId: string) => db.select({ id: osItens.id, nome: osItens.nomeServico, valor: osItens.valorCentavos }).from(osItens).where(eq(osItens.osId, osId)).orderBy(asc(osItens.nomeServico));
const eventos = (db: Database, osId: string) => db.select({ tipo: osEventos.tipo }).from(osEventos).where(eq(osEventos.osId, osId));
async function negado<T>(fn: () => Promise<T>) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const r = await fn();
    expect(warn).toHaveBeenCalledWith('[auth] acesso negado', expect.any(Object));
    return r;
  } finally {
    warn.mockRestore();
  }
}
const ACESSO_NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('edição de OS', () => {
  it('recepcao ajusta itens mas não desconto', () =>
    run(async ({ db, f, osId, cera }) => {
      await como(f, f.a.membros.recepcao.userId);
      const r = await editarItensAction({ osId, adicionar: [cera], remover: [] });
      expect(r).toMatchObject({ ok: true, data: { subtotalCentavos: 8000, totalCentavos: 8000 } });
      expect(await eventos(db, osId)).toEqual([{ tipo: 'itens' }]);
      expect(await negado(() => ajustarValorAction({ osId, descontoCentavos: 100, acrescimoCentavos: 0 }))).toEqual(ACESSO_NEGADO);
      expect(await linha(db, osId)).toMatchObject({ descontoCentavos: 0, totalCentavos: 8000 });
      // gerente ajusta valor; desconto e acréscimo entram no total e valem após nova edição de itens
      await como(f, f.a.membros.gerente.userId);
      expect(await ajustarValorAction({ osId, descontoCentavos: 500, acrescimoCentavos: 200 })).toMatchObject({ ok: true, data: { totalCentavos: 7700 } });
      expect(await eventos(db, osId)).toEqual([{ tipo: 'itens' }, { tipo: 'valor' }]);
      await como(f, f.a.membros.recepcao.userId);
      const item = (await itens(db, osId)).find((i) => i.nome === 'Cera')!;
      expect(await editarItensAction({ osId, adicionar: [], remover: [item.id] })).toMatchObject({ ok: true, data: { subtotalCentavos: 5000, totalCentavos: 4700 } });
    }));

  it('desconto maior que subtotal zera o total e não fica negativo', () =>
    run(async ({ db, f, osId }) => {
      await como(f, f.a.membros.dono.userId);
      expect(await ajustarValorAction({ osId, descontoCentavos: 99999, acrescimoCentavos: 0 })).toMatchObject({ ok: true, data: { subtotalCentavos: 5000, totalCentavos: 0 } });
      expect(await linha(db, osId)).toMatchObject({ totalCentavos: 0, descontoCentavos: 99999 });
      for (const ruim of [{ descontoCentavos: -1, acrescimoCentavos: 0 }, { descontoCentavos: 1.5, acrescimoCentavos: 0 }, { descontoCentavos: 0, acrescimoCentavos: Number.MAX_SAFE_INTEGER + 1 }, { descontoCentavos: 0, acrescimoCentavos: 0, total: 1 }]) {
        expect(await ajustarValorAction({ osId, ...ruim })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
    }));

  it.each(['entregue', 'cancelada'] as const)('edição em OS %s é recusada', (status) =>
    run(async ({ db, f, osId, cera }) => {
      await como(f, f.a.membros.dono.userId);
      expect(await editarItensAction({ osId, adicionar: [cera], remover: [] })).toMatchObject({ ok: false, code: 'OS_ENCERRADA' });
      expect(await ajustarValorAction({ osId, descontoCentavos: 1, acrescimoCentavos: 0 })).toMatchObject({ ok: false, code: 'OS_ENCERRADA' });
      expect(await linha(db, osId)).toMatchObject({ totalCentavos: 5000, descontoCentavos: 0 });
      expect(await itens(db, osId)).toHaveLength(1);
      expect(await eventos(db, osId)).toEqual([]);
    }, status));

  it('item adicionado usa preço atual; itens antigos mantêm o copiado', () =>
    run(async ({ db, f, osId, lavagem, cera, polimento }) => {
      await db.update(precos).set({ valorCentavos: 9000 }).where(eq(precos.servicoId, lavagem));
      await como(f, f.a.membros.gerente.userId);
      const r = await editarItensAction({ osId, adicionar: [cera, polimento], remover: [] });
      expect(r).toMatchObject({ ok: true, data: { subtotalCentavos: 16000, totalCentavos: 16000 } });
      expect(await itens(db, osId)).toMatchObject([{ nome: 'Cera', valor: 3000 }, { nome: 'Lavagem', valor: 5000 }, { nome: 'Polimento', valor: 8000 }]);
      // o item novo copia a comissão do serviço
      const [p] = await db.select().from(osItens).where(and(eq(osItens.osId, osId), eq(osItens.servicoId, polimento)));
      expect(p).toMatchObject({ comissaoTipo: 'fixo', comissaoValor: 100 });
    }));

  it('lavador recebe acesso negado', () =>
    run(async ({ db, f, osId, cera, itemId }) => {
      req.headers = await sessaoLavador(f);
      expect(await negado(() => editarItensAction({ osId, adicionar: [cera], remover: [itemId] }))).toEqual(ACESSO_NEGADO);
      expect(await negado(() => ajustarValorAction({ osId, descontoCentavos: 1, acrescimoCentavos: 0 }))).toEqual(ACESSO_NEGADO);
      expect(await itens(db, osId)).toHaveLength(1);
      expect(await linha(db, osId)).toMatchObject({ totalCentavos: 5000, descontoCentavos: 0 });
    }));

  it('recusa sem alterar: sem principal, duplicado, item/serviço de outra OS ou tenant', () =>
    run(async ({ db, f, osId, lavagem, cera, polimento, itemId }) => {
      await como(f, f.a.membros.dono.userId);
      const igual = async () => {
        expect(await itens(db, osId)).toMatchObject([{ id: itemId }]);
        expect(await linha(db, osId)).toMatchObject({ totalCentavos: 5000 });
        expect(await eventos(db, osId)).toEqual([]);
      };
      // remover o único principal; remover o principal deixando só adicional
      expect(await editarItensAction({ osId, adicionar: [], remover: [itemId] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await editarItensAction({ osId, adicionar: [cera], remover: [itemId] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      // trocar o principal por outro principal é permitido (outra chamada ao final); duplicados e já presente não
      expect(await editarItensAction({ osId, adicionar: [cera, cera], remover: [] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await editarItensAction({ osId, adicionar: [lavagem], remover: [] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await editarItensAction({ osId, adicionar: [], remover: [] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      // item inexistente / de outro tenant / serviço de outro tenant
      const vB = await semearVeiculo(db, f.b.tenantId);
      const osB = await criarOs(db, { tenantId: f.b.tenantId, veiculoId: vB.id, abertaPor: f.b.membros.recepcao.memberId });
      const [sB] = await db.select().from(servicos).where(eq(servicos.tenantId, f.b.tenantId));
      const [iB] = await db.insert(osItens).values({ tenantId: f.b.tenantId, osId: osB.id, servicoId: sB.id, porteId: vB.porteId, nomeServico: 'Lavagem', valorCentavos: 5000, comissaoTipo: 'fixo', comissaoValor: 1 }).returning();
      expect(await editarItensAction({ osId, adicionar: [], remover: [iB.id] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await editarItensAction({ osId, adicionar: [sB.id], remover: [] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await editarItensAction({ osId: osB.id, adicionar: [polimento], remover: [] })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await ajustarValorAction({ osId: osB.id, descontoCentavos: 1, acrescimoCentavos: 0 })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      await igual();
      expect(await itens(db, osB.id)).toHaveLength(1);
      expect(await linha(db, osB.id)).toMatchObject({ totalCentavos: 5000, descontoCentavos: 0 });
    }));

  it('trocar o principal por outro principal é aceito, em pronto também', () =>
    run(async ({ f, osId, polimento, itemId }) => {
      await como(f, f.a.membros.recepcao.userId);
      expect(await editarItensAction({ osId, adicionar: [polimento], remover: [itemId] })).toMatchObject({ ok: true, data: { totalCentavos: 8000, itens: [{ nome: 'Polimento' }] } });
    }, 'pronto'));
});
