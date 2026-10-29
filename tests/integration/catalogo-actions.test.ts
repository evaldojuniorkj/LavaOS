import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { portes, precos, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { definirPrecoAction, salvarPorteAction, salvarServicoAction } from '@/modules/catalogo/catalogo.actions';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };
const run = (fn: (db: Database, f: AuthFixtures) => Promise<void>) => withTestDatabase(async (db) => fn(db, await createAuthFixtures(db)));

async function como(f: AuthFixtures, userId: string) {
  const http = createHttp();
  expect((await http.post('/sign-in/email', { email: f.emailDe(userId), password: f.senha })).status).toBe(200);
  req.headers = http.headers();
}

const servico = { nome: 'Lavagem', adicional: false, comissaoTipo: 'percentual', comissaoValor: 3000 } as const;
const contagem = async (db: Database) =>
  JSON.stringify(await Promise.all([portes, servicos, precos].map(async (t) => (await db.execute(sql`select * from ${t} order by id`)).rows)));

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('catalogo.actions', () => {
  it('dono e gerente cadastram porte, serviço e preço (upsert) no próprio tenant', () =>
    run(async (db, f) => {
      for (const quem of [f.a.membros.dono, f.a.membros.gerente]) {
        await como(f, quem.userId);
        const p = await salvarPorteAction({ nome: ` Médio ${quem.userId.slice(0, 4)} ` });
        const s = await salvarServicoAction({ ...servico, nome: `Lavagem ${quem.userId.slice(0, 4)}`, descricao: 'x', duracaoEstimadaMin: 40 });
        if (!p.ok || !s.ok) throw new Error('falhou');
        expect(p.data.nome).toMatch(/^Médio \w+$/);
        expect(await definirPrecoAction({ servicoId: s.data.id, porteId: p.data.id, valorCentavos: 5000 })).toMatchObject({ ok: true });
        expect(await definirPrecoAction({ servicoId: s.data.id, porteId: p.data.id, valorCentavos: 5500 })).toMatchObject({ ok: true });
        const linhas = await db.select().from(precos).where(eq(precos.servicoId, s.data.id));
        expect(linhas).toHaveLength(1);
        expect(linhas[0]).toMatchObject({ tenantId: f.a.tenantId, valorCentavos: 5500 });
        const edit = await salvarServicoAction({ ...servico, id: s.data.id, nome: 'Renomeado', comissaoTipo: 'fixo', comissaoValor: 700, ativo: false });
        expect(edit).toMatchObject({ ok: true, data: { nome: 'Renomeado', comissaoTipo: 'fixo', comissaoValor: 700, ativo: false } });
      }
    }));

  it('recepcao e lavador recebem acesso negado em definirPrecoAction (e nas demais)', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const p = await salvarPorteAction({ nome: 'P' });
      const s = await salvarServicoAction(servico);
      if (!p.ok || !s.ok) throw new Error('falhou');
      const acoes = [
        () => definirPrecoAction({ servicoId: s.data.id, porteId: p.data.id, valorCentavos: 100 }),
        () => salvarPorteAction({ nome: 'X' }),
        () => salvarServicoAction(servico),
      ];
      const lavador = createHttp();
      expect((await lavador.post('/lavador-pin/sign-in', { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
      for (const entrar of [() => como(f, f.a.membros.recepcao.userId), async () => void (req.headers = lavador.headers()), async () => void (req.headers = new Headers())]) {
        await entrar();
        const antes = await contagem(db);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          for (const acao of acoes) expect(await acao()).toEqual(NEGADO);
        } finally {
          warn.mockRestore();
        }
        expect(await contagem(db)).toBe(antes);
      }
    }));

  it('valor decimal ou negativo é rejeitado', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const p = await salvarPorteAction({ nome: 'P' });
      const s = await salvarServicoAction(servico);
      if (!p.ok || !s.ok) throw new Error('falhou');
      const antes = await contagem(db);
      for (const valorCentavos of [12.5, -1, '10', Number.NaN, 2 ** 31]) {
        const r = await definirPrecoAction({ servicoId: s.data.id, porteId: p.data.id, valorCentavos });
        expect(r).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
      expect(await contagem(db)).toBe(antes);
    }));

  it('serviço sem comissão é rejeitado; percentual 10001 e fixo negativo também', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const antes = await contagem(db);
      const semComissao = { nome: 'X', adicional: false };
      for (const input of [
        semComissao,
        { ...semComissao, comissaoTipo: 'percentual' },
        { ...semComissao, comissaoValor: 100 },
        { ...servico, comissaoValor: 10001 },
        { ...servico, comissaoTipo: 'fixo', comissaoValor: -1 },
        { ...servico, comissaoValor: 10.5 },
        { ...servico, tenantId: f.b.tenantId },
      ]) {
        expect(await salvarServicoAction(input)).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
      expect(await salvarServicoAction({ ...servico, comissaoValor: 10000 })).toMatchObject({ ok: true });
      expect(await contagem(db)).not.toBe(antes);
    }));

  it('não mexe em catálogo de outro tenant (id alheio é não encontrado)', () =>
    run(async (db, f) => {
      const [pB] = await db.insert(portes).values({ tenantId: f.b.tenantId, nome: 'B' }).returning();
      const [sB] = await db.insert(servicos).values({ tenantId: f.b.tenantId, nome: 'B', comissaoTipo: 'fixo', comissaoValor: 0 }).returning();
      await como(f, f.a.membros.dono.userId);
      const pA = await salvarPorteAction({ nome: 'A' });
      if (!pA.ok) throw new Error('falhou');
      const antes = await contagem(db);
      expect(await definirPrecoAction({ servicoId: sB.id, porteId: pA.data.id, valorCentavos: 1 })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await salvarPorteAction({ id: pB.id, nome: 'Invadido' })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await salvarServicoAction({ ...servico, id: sB.id, nome: 'Invadido' })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await salvarPorteAction({ id: 'nao-e-uuid', nome: 'x' })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await contagem(db)).toBe(antes);
    }));
});
