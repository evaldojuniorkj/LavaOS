import { and, count, eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { requireTenantContext } from '@/lib/auth/context';
import { createAuth } from '@/lib/auth/server';
import { getDatabase } from '@/lib/db/client';
import { credenciaisLavador, membros, session } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { createMemberAction, deactivateMemberAction, resetPinAction } from '@/modules/equipe/equipe.actions';
import { createMember, deactivateMember, resetPin } from '@/modules/equipe/equipe.service';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };
const PIN = '/lavador-pin/sign-in';

const run = (fn: (db: Database, f: AuthFixtures) => Promise<void>) =>
  withTestDatabase(async (db) => fn(db, await createAuthFixtures(db)));

async function login(email: string, password: string) {
  const http = createHttp();
  expect((await http.post('/sign-in/email', { email, password })).status).toBe(200);
  return http;
}
const loginStaff = (f: AuthFixtures, userId: string) => login(f.emailDe(userId), f.senha);
async function loginPin(usuario: string, pin: string) {
  const http = createHttp();
  expect((await http.post(PIN, { usuario, pin })).status).toBe(200);
  return http;
}
const ctxDe = (http: ReturnType<typeof createHttp>) => requireTenantContext(http.headers());
const sessoes = async (db: Database, userId: string) => (await db.select({ n: count() }).from(session).where(eq(session.userId, userId)))[0].n;

/** Cookie velho reenviado: get-session protegido, guard de página e action. */
async function expectRevogado(cookie: string) {
  const res = await createHttp().get('/get-session', { cookie });
  expect(res.status).toBe(200);
  expect(await res.json()).toBeNull();
  await expect(requireTenantContext(new Headers({ cookie }))).rejects.toThrow('acesso negado');
  req.headers = new Headers({ cookie });
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    expect(await deactivateMemberAction({ memberId: crypto.randomUUID() })).toEqual(NEGADO);
  } finally {
    warn.mockRestore();
  }
}

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('desativação', () => {
  it('membro desativado perde todas as sessões: cookie antigo negado em get-session, página e action', () =>
    run(async (db, f) => {
      const g = f.a.membros.gerente;
      const [s1, s2] = [await loginStaff(f, g.userId), await loginStaff(f, g.userId)];
      req.headers = s1.headers();
      expect(await deactivateMemberAction({ memberId: crypto.randomUUID() })).toMatchObject({ code: 'NAO_ENCONTRADO' }); // ainda passa no guard
      expect(await sessoes(db, g.userId)).toBe(2);

      req.headers = (await loginStaff(f, f.a.membros.dono.userId)).headers();
      expect(await deactivateMemberAction({ memberId: g.memberId })).toEqual({ ok: true, data: null });
      expect((await db.select().from(membros).where(eq(membros.id, g.memberId)))[0].ativo).toBe(false);
      expect(await sessoes(db, g.userId)).toBe(0);
      for (const s of [s1, s2]) await expectRevogado(s.cookie());
      expect((await createHttp().post('/sign-in/email', { email: f.emailDe(g.userId), password: f.senha })).status).toBe(401);
    }));

  it('lavador desativado perde a sessão PIN', () =>
    run(async (db, f) => {
      const lav = await loginPin(f.lavador.usuario, f.lavador.pin);
      await deactivateMember(await ctxDe(await loginStaff(f, f.a.membros.gerente.userId)), f.a.membros.lavador.memberId);
      expect(await sessoes(db, f.a.membros.lavador.userId)).toBe(0);
      await expectRevogado(lav.cookie());
      expect((await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(401);
    }));

  it('revogação é global ao usuário: sessão em outro tenant também cai, mas o vínculo de lá continua', () =>
    run(async (db, f) => {
      const multi = await loginStaff(f, f.multi.userId);
      expect((await multi.post('/organization/set-active', { organizationId: f.b.tenantId })).status).toBe(200);
      await expect(ctxDe(multi)).resolves.toMatchObject({ tenantId: f.b.tenantId });
      await deactivateMember(await ctxDe(await loginStaff(f, f.a.membros.dono.userId)), f.multi.memberIdA);
      expect(await sessoes(db, f.multi.userId)).toBe(0);
      await expect(ctxDe(multi)).rejects.toThrow('acesso negado');
      // novo login: só B está ativo, então o servidor já o seleciona
      await expect(ctxDe(await loginStaff(f, f.multi.userId))).resolves.toMatchObject({ tenantId: f.b.tenantId, perfil: 'gerente' });
    }));

  it('duas desativações concorrentes de donos não removem o último dono', () =>
    run(async (db, f) => {
      const dono1 = await ctxDe(await loginStaff(f, f.a.membros.dono.userId));
      const senha = `senha-${crypto.randomUUID()}`;
      const email = `${crypto.randomUUID()}@teste.invalid`;
      const dono2 = await createMember(dono1, { perfil: 'dono', nomeExibicao: 'Dono 2', email, senha });
      const ctx2 = await ctxDe(await login(email, senha));
      // Barreira: outra transação segura as linhas dos donos; as duas desativações só seguem quando ambas estiverem
      // esperando trava. Sem a trava do tenant, as duas contariam 2 donos antes de gravar.
      let disputa!: Promise<PromiseSettledResult<void>[]>;
      await db.transaction(async (tx) => {
        await tx.select({ id: membros.id }).from(membros).where(and(eq(membros.tenantId, f.a.tenantId), eq(membros.perfil, 'dono'))).for('update');
        disputa = Promise.allSettled([deactivateMember(dono1, dono2.id), deactivateMember(ctx2, dono1.memberId)]);
        const esperando = sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`;
        while ((await db.execute<{ n: number }>(esperando)).rows[0].n < 2) await new Promise((r) => setImmediate(r));
      });
      const r = await disputa;
      expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
      // o perdedor vê o ator já inativo (acesso negado) ou o último dono (regra) — nunca as duas passam
      for (const x of r) if (x.status === 'rejected') expect(String(x.reason)).toMatch(/acesso negado|pelo menos um dono/);
      const ativos = await db.select({ n: count() }).from(membros).where(and(eq(membros.tenantId, f.a.tenantId), eq(membros.perfil, 'dono'), eq(membros.ativo, true)));
      expect(ativos[0].n).toBe(1);
    }));

  it('último dono não pode se desativar', () =>
    run(async (db, f) => {
      const dono = await loginStaff(f, f.a.membros.dono.userId);
      req.headers = dono.headers();
      expect(await deactivateMemberAction({ memberId: f.a.membros.dono.memberId })).toEqual({
        ok: false,
        code: 'ULTIMO_DONO',
        message: 'O lava jato precisa de pelo menos um dono ativo.',
      });
      expect((await db.select().from(membros).where(eq(membros.id, f.a.membros.dono.memberId)))[0].ativo).toBe(true);
      await expect(ctxDe(dono)).resolves.toMatchObject({ perfil: 'dono' });
    }));
});

describe('reset de PIN', () => {
  it('troca o hash, incrementa a versão, zera o bloqueio e revoga todas as sessões PIN', () =>
    run(async (db, f) => {
      const { memberId, userId } = f.a.membros.lavador;
      const [l1, l2] = [await loginPin(f.lavador.usuario, f.lavador.pin), await loginPin(f.lavador.usuario, f.lavador.pin)];
      for (let i = 0; i < 5; i++) await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: '1111' });
      const antes = (await db.select().from(credenciaisLavador).where(eq(credenciaisLavador.membroId, memberId)))[0];
      expect(antes.bloqueadoAte).not.toBeNull();

      req.headers = (await loginStaff(f, f.a.membros.gerente.userId)).headers();
      expect(await resetPinAction({ memberId, pin: '7777' })).toEqual({ ok: true, data: null });
      const depois = (await db.select().from(credenciaisLavador).where(eq(credenciaisLavador.membroId, memberId)))[0];
      expect(depois).toMatchObject({ versao: antes.versao + 1, errosConsecutivos: 0, bloqueadoAte: null });
      expect(depois.pinHash).not.toBe(antes.pinHash);
      expect(await sessoes(db, userId)).toBe(0);
      for (const s of [l1, l2]) await expectRevogado(s.cookie());

      expect((await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(401);
      await expect(ctxDe(await loginPin(f.lavador.usuario, '7777'))).resolves.toMatchObject({ memberId, perfil: 'lavador' });
    }));

  it('reset concorrente com login (barreira): sessão emitida com a versão antiga não passa no guard', () =>
    run(async (_db, f) => {
      const gerente = await ctxDe(await loginStaff(f, f.a.membros.gerente.userId));
      let chegou!: () => void;
      let libera!: () => void;
      const verificou = new Promise<void>((r) => (chegou = r));
      const portao = new Promise<void>((r) => (libera = r));
      const http = createHttp(createAuth({ aposVerificar: async () => (chegou(), portao) }).handler);
      const login = http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin });
      await verificou; // PIN antigo já verificado com a versão 1
      await resetPin(gerente, f.a.membros.lavador.memberId, '2468');
      libera();
      const res = await login;
      if (res.headers.getSetCookie().length > 0) await expect(ctxDe(http)).rejects.toThrow('acesso negado');
      else expect(res.status).not.toBe(200);
      await expect(ctxDe(await loginPin(f.lavador.usuario, '2468'))).resolves.toMatchObject({ perfil: 'lavador' });
    }));

  it('reset não derruba sessões de staff nem de outro lavador', () =>
    run(async (db, f) => {
      const dono = await loginStaff(f, f.a.membros.dono.userId);
      req.headers = dono.headers();
      const r = await createMemberAction({ perfil: 'lavador', nomeExibicao: 'Outro', usuario: 'outro.lav', pin: '1357' });
      if (!r.ok || !r.data) throw new Error('falhou');
      const outro = await loginPin('outro.lav', '1357');
      expect(await resetPinAction({ memberId: f.a.membros.lavador.memberId, pin: '7777' })).toEqual({ ok: true, data: null });
      await expect(ctxDe(dono)).resolves.toMatchObject({ perfil: 'dono' });
      await expect(ctxDe(outro)).resolves.toMatchObject({ memberId: r.data.id });
      expect(await sessoes(db, f.a.membros.dono.userId)).toBe(1);
    }));
});
