import { count, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { requirePermission, requireTenantContext } from '@/lib/auth/context';
import { getDatabase } from '@/lib/db/client';
import { convites, lavaJatos, membros, session, user } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

const SETE_DIAS = 7 * 24 * 60 * 60;

const run = (fn: (db: Database, f: AuthFixtures) => Promise<void>) =>
  withTestDatabase(async (db) => fn(db, await createAuthFixtures(db)));

async function login(f: AuthFixtures, userId: string) {
  const http = createHttp();
  const res = await http.post('/sign-in/email', { email: f.emailDe(userId), password: f.senha });
  expect(res.status).toBe(200);
  return http;
}

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('login de staff por e-mail', () => {
  it.each(['dono', 'gerente', 'recepcao'] as const)('%s recebe cookie HttpOnly e contexto do tenant certo', (perfil) =>
    run(async (db, f) => {
      const m = f.a.membros[perfil];
      const http = createHttp();
      const res = await http.post('/sign-in/email', { email: f.emailDe(m.userId), password: f.senha });
      expect(res.status).toBe(200);
      const raw = res.headers.getSetCookie().find((c) => c.includes('session_token='))!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);
      expect(raw).not.toMatch(/Secure/i); // http local; produção/HTTPS liga Secure
      expect(raw).toMatch(new RegExp(`Max-Age=${SETE_DIAS}`));
      const ctx = await requireTenantContext(http.headers());
      expect(ctx).toMatchObject({ tenantId: f.a.tenantId, userId: m.userId, memberId: m.memberId, perfil });
      const [s] = await db.select().from(session).where(eq(session.userId, m.userId));
      expect(Math.round((s.expiresAt.getTime() - s.createdAt.getTime()) / 1000)).toBeCloseTo(SETE_DIAS, -1);
    }),
  );

  it('credenciais inválidas não dão cookie e erram em português', () =>
    run(async (_db, f) => {
      for (const [status, body] of [
        [401, { email: f.emailDe(f.a.membros.dono.userId), password: 'senha-errada-123' }],
        [401, { email: 'ninguem@teste.invalid', password: f.senha }],
        [400, { email: 'nao-e-email', password: f.senha }],
      ] as const) {
        const res = await createHttp().post('/sign-in/email', body);
        expect(res.status).toBe(status);
        expect(res.headers.getSetCookie()).toEqual([]);
        expect((await res.json()).message).toBe('E-mail ou senha inválidos.');
      }
    }));

  it('origem não confiável é recusada sem cookie', () =>
    run(async (_db, f) => {
      const res = await createHttp().post('/sign-in/email', { email: f.emailDe(f.a.membros.dono.userId), password: f.senha }, { origin: 'https://evil.example' });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }));

  it('membro desativado não consegue logar', () =>
    run(async (db, f) => {
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, f.a.membros.gerente.memberId));
      const res = await createHttp().post('/sign-in/email', { email: f.emailDe(f.a.membros.gerente.userId), password: f.senha });
      expect(res.status).toBe(401);
      expect(res.headers.getSetCookie()).toEqual([]);
    }));
});

describe('sessão', () => {
  it('logout invalida o cookie velho', () =>
    run(async (_db, f) => {
      const http = await login(f, f.a.membros.dono.userId);
      const velho = http.cookie();
      expect((await http.post('/sign-out')).status).toBe(200);
      const res = await http.get('/get-session', { cookie: velho });
      expect(await res.json()).toBeNull();
      await expect(requireTenantContext(new Headers({ cookie: velho }))).rejects.toThrow('acesso negado');
    }));

  it('sessão expirada no banco nega acesso', () =>
    run(async (db, f) => {
      const http = await login(f, f.a.membros.gerente.userId);
      await db.update(session).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(session.userId, f.a.membros.gerente.userId));
      expect(await (await http.get('/get-session')).json()).toBeNull();
      await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
    }));

  it('get-session não estende a sessão (sem refresh deslizante)', () =>
    run(async (db, f) => {
      const http = await login(f, f.a.membros.dono.userId);
      const antes = new Date(Date.now() + 60_000);
      await db.update(session).set({ expiresAt: antes, updatedAt: new Date(Date.now() - 2 * 86_400_000) }).where(eq(session.userId, f.a.membros.dono.userId));
      expect((await http.get('/get-session')).status).toBe(200);
      const [s] = await db.select().from(session).where(eq(session.userId, f.a.membros.dono.userId));
      expect(s.expiresAt.getTime()).toBe(antes.getTime());
    }));

  it('cookie adulterado não dá acesso nem revela dados', () =>
    run(async (_db, f) => {
      const http = await login(f, f.a.membros.dono.userId);
      const adulterado = http.cookie().replace(/session_token=([^;.]+)/, `session_token=${crypto.randomUUID()}`);
      expect(await (await http.get('/get-session', { cookie: adulterado })).json()).toBeNull();
      expect((await http.get('/organization/list', { cookie: adulterado })).status).toBe(401);
      await expect(requireTenantContext(new Headers({ cookie: adulterado }))).rejects.toThrow('acesso negado');
    }));

  it('membro desativado com o mesmo cookie perde acesso, inclusive nos endpoints auth', () =>
    run(async (db, f) => {
      const m = f.a.membros.recepcao;
      const http = await login(f, m.userId);
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ perfil: 'recepcao' });
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, m.memberId));
      await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
      expect(await (await http.get('/get-session')).json()).toBeNull();
      expect((await http.get('/organization/list')).status).toBe(403);
      expect((await http.post('/organization/set-active', { organizationId: f.a.tenantId })).status).toBe(403);
    }));
});

describe('seleção de tenant', () => {
  it('único vínculo ativo é selecionado no servidor', () =>
    run(async (db, f) => {
      // multi perde o vínculo B: sobra só A
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, f.multi.memberIdB));
      const http = await login(f, f.multi.userId);
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ tenantId: f.a.tenantId, memberId: f.multi.memberIdA });
    }));

  it('múltiplos vínculos exigem seleção válida antes do contexto', () =>
    run(async (_db, f) => {
      const http = await login(f, f.multi.userId);
      await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
      const lista = (await (await http.get('/organization/list')).json()) as { id: string }[];
      expect(lista.map((o) => o.id).sort()).toEqual([f.a.tenantId, f.b.tenantId].sort());
      expect((await http.post('/organization/set-active', { organizationId: f.b.tenantId })).status).toBe(200);
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ tenantId: f.b.tenantId, perfil: 'gerente' });
    }));

  it('seleção sem vínculo ativo é negada e a listagem omite o vínculo inativo', () =>
    run(async (db, f) => {
      const http = await login(f, f.multi.userId);
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, f.multi.memberIdB));
      const lista = (await (await http.get('/organization/list')).json()) as { id: string }[];
      expect(lista.map((o) => o.id)).toEqual([f.a.tenantId]);
      for (const body of [{ organizationId: f.b.tenantId }, { organizationId: crypto.randomUUID() }, { organizationSlug: f.b.slug }, { organizationId: 'x' }]) {
        expect((await http.post('/organization/set-active', body)).status).toBe(403);
      }
      await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
      expect((await http.post('/organization/set-active', { organizationId: f.a.tenantId })).status).toBe(200);
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ tenantId: f.a.tenantId });
    }));

  it('dono de A não seleciona B', () =>
    run(async (_db, f) => {
      const http = await login(f, f.a.membros.dono.userId);
      expect((await http.post('/organization/set-active', { organizationId: f.b.tenantId })).status).toBe(403);
    }));
});

describe('superfície HTTP bloqueada', () => {
  it('cadastro público é negado em GET e POST e não cria usuário', () =>
    run(async (db) => {
      const [{ antes }] = await db.select({ antes: count() }).from(user);
      const body = { email: 'novo@teste.invalid', password: 'senha-nova-123', name: 'Novo', role: 'dono' };
      for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
        expect((await createHttp().call(method, '/sign-up/email', { body: method === 'GET' ? undefined : body })).status).toBe(404);
      }
      const [{ depois }] = await db.select({ depois: count() }).from(user);
      expect(depois).toBe(antes);
    }));

  it('mutações de organização, membro, convite e senha são negadas mesmo autenticado', () =>
    run(async (db, f) => {
      const http = await login(f, f.a.membros.dono.userId);
      const rec = f.a.membros.recepcao;
      const tentativas: [string, string, unknown?][] = [
        ['POST', '/organization/create', { name: 'X', slug: 'x' }],
        ['POST', '/organization/update', { organizationId: f.a.tenantId, data: { name: 'Hack' } }],
        ['POST', '/organization/delete', { organizationId: f.a.tenantId }],
        ['POST', '/organization/update-member-role', { memberId: rec.memberId, role: 'dono', organizationId: f.a.tenantId }],
        ['POST', '/organization/add-member', { userId: f.b.membros.dono.userId, role: 'dono' }],
        ['POST', '/organization/remove-member', { memberIdOrEmail: rec.memberId }],
        ['POST', '/organization/leave', { organizationId: f.a.tenantId }],
        ['POST', '/organization/invite-member', { email: 'x@teste.invalid', role: 'dono' }],
        ['POST', '/organization/accept-invitation', { invitationId: crypto.randomUUID() }],
        ['GET', '/organization/list-members'],
        ['GET', '/organization/get-full-organization'],
        ['GET', '/organization/update-member-role'],
        ['POST', '/change-password', { currentPassword: f.senha, newPassword: 'outra-senha-123' }],
        ['POST', '/request-password-reset', { email: f.emailDe(rec.userId) }],
        ['POST', '/reset-password', { newPassword: 'outra-senha-123', token: 'x' }],
        ['POST', '/update-user', { name: 'Hack' }],
        ['POST', '/delete-user', {}],
        ['GET', '/list-sessions'],
        ['PATCH', '/organization/update', { organizationId: f.a.tenantId, data: { name: 'Hack' } }],
        ['POST', '/sign-up/email/', { email: 'n@teste.invalid', password: 'senha-nova-123', name: 'N' }],
      ];
      for (const [method, path, body] of tentativas) {
        const res = await http.call(method, path, { body });
        expect(res.status, `${method} ${path}`).toBe(404);
      }
      const [r] = await db.select({ perfil: membros.perfil }).from(membros).where(eq(membros.id, rec.memberId));
      expect(r.perfil).toBe('recepcao');
      const [org] = await db.select({ nome: lavaJatos.nome }).from(lavaJatos).where(eq(lavaJatos.id, f.a.tenantId));
      expect(org.nome).toBe('Lava Jato tenant-a');
      expect(await db.select().from(convites)).toEqual([]);
      expect((await db.select({ n: count() }).from(lavaJatos))[0].n).toBe(2);
    }));
});

describe('requirePermission (reader real)', () => {
  it('nega e registra a tentativa sem cookie, token ou senha', () =>
    run(async (_db, f) => {
      const http = await login(f, f.a.membros.recepcao.userId);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await expect(requirePermission(http.headers(), 'equipe:gerenciar')).rejects.toThrow('acesso negado');
        expect(warn).toHaveBeenCalledTimes(1);
        const logged = JSON.stringify(warn.mock.calls);
        expect(logged).toContain('equipe:gerenciar');
        expect(logged).toContain(f.a.membros.recepcao.memberId);
        const token = http.cookie().match(/session_token=([^;.]+)/)![1];
        for (const segredo of [token, f.senha, 'cookie']) expect(logged).not.toContain(segredo);
      } finally {
        warn.mockRestore();
      }
    }));

  it('libera dono em equipe:gerenciar_lideranca', () =>
    run(async (_db, f) => {
      const http = await login(f, f.a.membros.dono.userId);
      await expect(requirePermission(http.headers(), 'equipe:gerenciar_lideranca')).resolves.toMatchObject({ perfil: 'dono' });
    }));
});
