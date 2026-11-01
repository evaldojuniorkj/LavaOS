import { afterAll, describe, expect, it, vi } from 'vitest';
import InicioPage from '@/app/(interno)/inicio/page';
import { getDatabase } from '@/lib/db/client';
import { carregarPainelAction } from '@/modules/painel/painel.actions';
import * as repo from '@/modules/painel/painel.repo';
import { createAuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock('@/modules/painel/painel.repo', { spy: true });

const NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };
const destino = async () => InicioPage().then(() => 'sem redirect', (e: Error) => e.message);

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('painel', () => {
  it('dono, gerente e recepção leem o painel', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      for (const m of ['dono', 'gerente', 'recepcao'] as const) {
        req.headers = await sessaoStaff(f, f.a.membros[m].userId);
        expect(await carregarPainelAction()).toMatchObject({ ok: true, data: { contagem: { aguardando: 0 } } });
      }
    }));

  it('lavador e sem sessão são negados sem tocar no banco', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      vi.mocked(repo.carregarPainel).mockClear();
      req.headers = await sessaoLavador(f);
      expect(await carregarPainelAction()).toEqual(NEGADO);
      req.headers = new Headers();
      expect(await carregarPainelAction()).toEqual(NEGADO);
      expect(repo.carregarPainel).not.toHaveBeenCalled();
    }));

  it('/inicio manda cada perfil ao seu destino', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      const esperado = { dono: '/painel', gerente: '/painel', recepcao: '/fila' } as const;
      for (const m of ['dono', 'gerente', 'recepcao'] as const) {
        req.headers = await sessaoStaff(f, f.a.membros[m].userId);
        expect(await destino()).toBe(`REDIRECT ${esperado[m]}`);
      }
      req.headers = await sessaoLavador(f);
      expect(await destino()).toBe('REDIRECT /lavador');
      req.headers = new Headers();
      expect(await destino()).toBe('REDIRECT /login?motivo=sessao');
    }));
});
