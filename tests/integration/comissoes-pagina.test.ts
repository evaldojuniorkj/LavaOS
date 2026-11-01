import { afterAll, describe, expect, it, vi } from 'vitest';
import AcertoPage from '@/app/(interno)/comissoes/acerto/[id]/page';
import ComissoesPage from '@/app/(interno)/comissoes/page';
import { getDatabase } from '@/lib/db/client';
import * as repo from '@/modules/comissoes/comissoes.repo';
import { createAuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));
vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error('NOT_FOUND');
  },
}));
vi.mock('@/modules/comissoes/comissoes.repo', { spy: true });

const ID = '00000000-0000-4000-8000-000000000000';
const paginas = [() => ComissoesPage(), () => AcertoPage({ params: Promise.resolve({ id: ID }) } as PageProps<'/comissoes/acerto/[id]'>)];
const render = (p: () => Promise<unknown>) => p().then((r) => JSON.stringify(r), (e: Error) => e.message);

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('página de comissões', () => {
  it('lavador vai para o app dele e recepção vê acesso negado, sem ler comissões', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      vi.mocked(repo.pendentesPorMembro).mockClear();
      vi.mocked(repo.detalheAcerto).mockClear();
      for (const p of paginas) {
        req.headers = await sessaoLavador(f);
        expect(await render(p)).toBe('REDIRECT /lavador');
        req.headers = await sessaoStaff(f, f.a.membros.recepcao.userId);
        expect(await render(p)).toContain('Acesso negado');
        req.headers = new Headers();
        expect(await render(p)).toBe('REDIRECT /login?motivo=sessao');
      }
      expect(repo.pendentesPorMembro).not.toHaveBeenCalled();
      expect(repo.detalheAcerto).not.toHaveBeenCalled();
    }));

  it('gerente lê a tela; acerto inexistente ou id malformado é 404', () =>
    withTestDatabase(async (db) => {
      const f = await createAuthFixtures(db);
      req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
      expect(await render(paginas[0])).not.toContain('Acesso negado');
      expect(await render(paginas[1])).toBe('NOT_FOUND');
      expect(await render(() => AcertoPage({ params: Promise.resolve({ id: 'x' }) } as PageProps<'/comissoes/acerto/[id]'>))).toBe('NOT_FOUND');
    }));
});
