import { and, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { Perfil, TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { categoriasDespesa, despesas } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { abrirCaixa, fecharCaixa } from '@/modules/caixa/caixa.service';
import { resumoDoCaixa } from '@/modules/caixa/caixa.repo';
import { lancarDespesaAction, salvarCategoriaAction } from '@/modules/despesas/despesas.actions';
import { contasAPagar, listarCategorias, listarDespesas } from '@/modules/despesas/despesas.repo';
import { cancelarDespesa, lancarDespesa, marcarComoPaga, salvarCategoria } from '@/modules/despesas/despesas.service';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import type { TenantFixture } from '../helpers/fixtures';
import { withTestDatabase } from '../helpers/db';
import { sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const ctxDe = (t: TenantFixture, perfil: Perfil) => ({ tenantId: t.tenantId, userId: t.membros[perfil].userId, memberId: t.membros[perfil].memberId, perfil, sessionId: 'x' }) as TenantContext;
type C = { db: Database; f: AuthFixtures; ger: TenantContext; cat: (nome: string) => Promise<string> };
const run = (fn: (c: C) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const cat = async (nome: string) => (await db.select().from(categoriasDespesa).where(and(eq(categoriasDespesa.tenantId, f.a.tenantId), eq(categoriasDespesa.nome, nome))))[0].id;
    await fn({ db, f, ger: ctxDe(f.a, 'gerente'), cat });
  });

const dia = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
const hoje = dia(new Date());
const ontem = dia(new Date(Date.now() - 24 * 3600_000));
const amanha = dia(new Date(Date.now() + 24 * 3600_000));

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('despesas', () => {
  it('vale pago com dinheiro do caixa reduz o esperado; cancelado volta', () =>
    run(async ({ db, ger, cat }) => {
      const { caixa } = await abrirCaixa(ger, { trocoInicialCentavos: 10000 }, db);
      const d = await lancarDespesa(ger, { categoriaId: await cat('Vales'), descricao: 'Vale do João', valorCentavos: 3000, doCaixa: true }, db);
      expect(d).toMatchObject({ caixaId: caixa.id, pagoEm: expect.any(Date) });
      expect(await resumoDoCaixa(ger, caixa.id, db)).toMatchObject({ esperadoDinheiro: 7000, saidas: [{ descricao: 'Vale do João', valorCentavos: 3000 }] });
      await cancelarDespesa(ger, { despesaId: d.id, motivo: 'lançado errado' }, db);
      await expect(cancelarDespesa(ger, { despesaId: d.id, motivo: 'de novo' }, db)).rejects.toMatchObject({ code: 'JA_CANCELADA' });
      expect(await resumoDoCaixa(ger, caixa.id, db)).toMatchObject({ esperadoDinheiro: 10000, saidas: [] });
      expect((await fecharCaixa(ger, { caixaId: caixa.id, dinheiroContadoCentavos: 10000 }, db)).caixa.diferencaCentavos).toBe(0);
    }));

  it('saída do caixa exige o caixa aberto de hoje e pagamento hoje; cancelar exige o caixa ainda aberto', () =>
    run(async ({ db, ger, cat }) => {
      const categoriaId = await cat('Produtos');
      await expect(lancarDespesa(ger, { categoriaId, descricao: 'Cera', valorCentavos: 100, doCaixa: true }, db)).rejects.toMatchObject({ code: 'SEM_CAIXA', message: 'Abra o caixa de hoje antes.' });
      const { caixa } = await abrirCaixa(ger, { trocoInicialCentavos: 0 }, db);
      await expect(lancarDespesa(ger, { categoriaId, descricao: 'Cera', valorCentavos: 100, pagoEm: ontem, doCaixa: true }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { pagoEm: expect.any(Array) } });
      const d = await lancarDespesa(ger, { categoriaId, descricao: 'Cera', valorCentavos: 100, pagoEm: hoje, doCaixa: true }, db);
      await fecharCaixa(ger, { caixaId: caixa.id, dinheiroContadoCentavos: 0 }, db);
      await expect(lancarDespesa(ger, { categoriaId, descricao: 'Cera', valorCentavos: 100, doCaixa: true }, db)).rejects.toMatchObject({ code: 'SEM_CAIXA' });
      await expect(cancelarDespesa(ger, { despesaId: d.id, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'SEM_CAIXA' });
      expect(await db.select().from(despesas)).toHaveLength(1);
    }));

  it('a pagar aparece em contas a pagar (vencida marcada) e some ao marcar paga', () =>
    run(async ({ db, ger, cat }) => {
      const categoriaId = await cat('Aluguel');
      const velha = await lancarDespesa(ger, { categoriaId, descricao: 'Luz', valorCentavos: 20000, vencimento: ontem }, db);
      const nova = await lancarDespesa(ger, { categoriaId, descricao: 'Aluguel', valorCentavos: 150000, vencimento: amanha }, db);
      await lancarDespesa(ger, { categoriaId, descricao: 'Já paga', valorCentavos: 500, pagoEm: ontem }, db);
      await expect(lancarDespesa(ger, { categoriaId, descricao: 'Sem data', valorCentavos: 500 }, db)).rejects.toMatchObject({ code: 'VALIDACAO' });
      await expect(lancarDespesa(ger, { categoriaId, descricao: 'Futuro', valorCentavos: 500, pagoEm: amanha }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { pagoEm: expect.any(Array) } });
      expect((await contasAPagar(ger, new Date(), db)).map((c) => [c.descricao, c.vencida, c.categoria])).toEqual([
        ['Luz', true, 'Aluguel'],
        ['Aluguel', false, 'Aluguel'],
      ]);
      // sem doCaixa não precisa de caixa aberto
      expect(await marcarComoPaga(ger, { despesaId: velha.id }, db)).toMatchObject({ pagoEm: expect.any(Date), caixaId: null });
      await expect(marcarComoPaga(ger, { despesaId: velha.id }, db)).rejects.toMatchObject({ code: 'JA_PAGA' });
      await expect(marcarComoPaga(ger, { despesaId: nova.id, doCaixa: true }, db)).rejects.toMatchObject({ code: 'SEM_CAIXA' });
      await cancelarDespesa(ger, { despesaId: nova.id, motivo: 'contrato acabou' }, db);
      await expect(marcarComoPaga(ger, { despesaId: nova.id }, db)).rejects.toMatchObject({ code: 'CANCELADA' });
      expect(await contasAPagar(ger, new Date(), db)).toEqual([]);
      expect((await listarDespesas(ger, { de: ontem, ate: hoje }, db)).map((d) => d.descricao).sort()).toEqual(['Já paga', 'Luz']);
    }));

  it('marcar paga com dinheiro do caixa entra nas saídas', () =>
    run(async ({ db, ger, cat }) => {
      const d = await lancarDespesa(ger, { categoriaId: await cat('Água e luz'), descricao: 'Água', valorCentavos: 4000, vencimento: hoje }, db);
      const { caixa } = await abrirCaixa(ger, { trocoInicialCentavos: 5000 }, db);
      expect(await marcarComoPaga(ger, { despesaId: d.id, doCaixa: true }, db)).toMatchObject({ caixaId: caixa.id });
      expect(await resumoDoCaixa(ger, caixa.id, db)).toMatchObject({ esperadoDinheiro: 1000 });
    }));

  it('categorias: cria, renomeia e desativa; "Comissões" travada; nome duplicado vira erro de campo; inativa não recebe lançamento', () =>
    run(async ({ db, ger, cat }) => {
      const nova = await salvarCategoria(ger, { nome: 'Manutenção' }, db);
      expect(nova).toMatchObject({ nome: 'Manutenção', ativo: true, sistema: false });
      expect(await salvarCategoria(ger, { id: nova.id, nome: 'Reparos', ativo: false }, db)).toMatchObject({ nome: 'Reparos', ativo: false });
      await expect(lancarDespesa(ger, { categoriaId: nova.id, descricao: 'x', valorCentavos: 1, pagoEm: hoje }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { categoriaId: expect.any(Array) } });
      const comissoes = await cat('Comissões');
      await expect(salvarCategoria(ger, { id: comissoes, nome: 'Comissões', ativo: false }, db)).rejects.toMatchObject({ code: 'CATEGORIA_SISTEMA' });
      await expect(salvarCategoria(ger, { id: comissoes, nome: 'Bônus' }, db)).rejects.toMatchObject({ code: 'CATEGORIA_SISTEMA' });
      await expect(salvarCategoria(ger, { nome: 'Vales' }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { nome: ['Já existe uma categoria com esse nome.'] } });
      await expect(salvarCategoria(ger, { id: nova.id, nome: 'Vales' }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { nome: expect.any(Array) } });
      expect((await listarCategorias(ger, db)).map((c) => c.nome)).toContain('Reparos');
    }));

  it('recepção negada; action valida estrito e devolve erro de campo', () =>
    run(async ({ f, cat }) => {
      const categoriaId = await cat('Outros');
      req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(await lancarDespesaAction({ categoriaId, descricao: 'x', valorCentavos: 100, pagoEm: hoje })).toEqual({ ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' });
      expect(await salvarCategoriaAction({ nome: 'Nova' })).toMatchObject({ ok: false, code: 'ACESSO_NEGADO' });
      warn.mockRestore();
      req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
      expect(await lancarDespesaAction({ categoriaId, descricao: 'x', valorCentavos: 100, pagoEm: hoje, tenantId: f.b.tenantId })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await lancarDespesaAction({ categoriaId, descricao: 'x', valorCentavos: 0, pagoEm: hoje })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { valorCentavos: expect.any(Array) } });
      expect(await salvarCategoriaAction({ nome: 'Vales' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { nome: expect.any(Array) } });
      expect(await lancarDespesaAction({ categoriaId, descricao: 'Sabão', valorCentavos: 100, pagoEm: hoje })).toMatchObject({ ok: true, data: { descricao: 'Sabão' } });
    }));

  it('outro tenant não vê despesa nem categoria e não usa a categoria de A', () =>
    run(async ({ db, f, ger, cat }) => {
      const categoriaId = await cat('Outros');
      const d = await lancarDespesa(ger, { categoriaId, descricao: 'x', valorCentavos: 100, vencimento: hoje }, db);
      const b = ctxDe(f.b, 'gerente');
      expect(await contasAPagar(b, new Date(), db)).toEqual([]);
      expect(await listarDespesas(b, { de: hoje, ate: hoje }, db)).toEqual([]);
      expect((await listarCategorias(b, db)).map((c) => c.id)).not.toContain(categoriaId);
      await expect(lancarDespesa(b, { categoriaId, descricao: 'x', valorCentavos: 100, pagoEm: hoje }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { categoriaId: expect.any(Array) } });
      await expect(marcarComoPaga(b, { despesaId: d.id }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      await expect(cancelarDespesa(b, { despesaId: d.id, motivo: 'x' }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      await expect(salvarCategoria(b, { id: categoriaId, nome: 'y' }, db)).rejects.toMatchObject({ code: 'NAO_ENCONTRADO' });
      expect((await db.select().from(despesas).where(eq(despesas.id, d.id)))[0]).toMatchObject({ pagoEm: null, canceladaEm: null });
    }));
});
