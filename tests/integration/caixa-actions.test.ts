import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { caixas } from '@/lib/db/schema';
import { abrirCaixaAction, carregarCaixaAction } from '@/modules/caixa/caixa.actions';
import * as repo from '@/modules/caixa/caixa.repo';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { createAuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('@/modules/caixa/caixa.repo', { spy: true });

const NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('carregarCaixaAction', () => {
  it('sem caixa → resumo null; aberto hoje → resumo; aberto esquecido de outro dia vem no lugar do de hoje', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      const hoje = dataDoCaixa(new Date());
      req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
      expect(await carregarCaixaAction()).toEqual({ ok: true, data: { hoje, resumo: null } });
      expect(await abrirCaixaAction({ trocoInicialCentavos: 5000 })).toMatchObject({ ok: true });
      expect(await carregarCaixaAction()).toMatchObject({ ok: true, data: { hoje, resumo: { caixa: { data: hoje, status: 'aberto', trocoInicialCentavos: 5000 }, esperadoDinheiro: 5000 } } });
      // outro tenant com caixa aberto de outro dia não aparece; o de A segue o de hoje
      await db.insert(caixas).values({ tenantId: f.b.tenantId, data: '2026-01-02', trocoInicialCentavos: 0, abertoPor: f.b.membros.recepcao.memberId });
      expect(await carregarCaixaAction()).toMatchObject({ ok: true, data: { resumo: { caixa: { tenantId: f.a.tenantId, data: hoje } } } });
      req.headers = await sessaoStaff(f, f.b.membros.recepcao.userId);
      expect(await carregarCaixaAction()).toMatchObject({ ok: true, data: { hoje, resumo: { caixa: { data: '2026-01-02', status: 'aberto' } } } });
    }));

  it('lavador e sem sessão são negados sem tocar no banco', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      vi.mocked(repo.caixaAtual).mockClear();
      req.headers = await sessaoLavador(f);
      expect(await carregarCaixaAction()).toEqual(NEGADO);
      req.headers = new Headers();
      expect(await carregarCaixaAction()).toEqual(NEGADO);
      expect(repo.caixaAtual).not.toHaveBeenCalled();
    }));
});
