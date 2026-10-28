import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { hashSecret, verifySecret } from '@/lib/auth/credentials';
import { createTenantGuards, requireTenantContext } from '@/lib/auth/context';
import type { PinHasher } from '@/lib/auth/pin.repo';
import { createAuth } from '@/lib/auth/server';
import { getDatabase } from '@/lib/db/client';
import { account, credenciaisLavador, membros, session } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

const TRINTA_DIAS = 30 * 24 * 60 * 60;
const QUINZE_MIN = 15 * 60 * 1000;
const PIN = '/lavador-pin/sign-in';
const INVALIDO = 'Usuário ou PIN inválidos.';

const run = (fn: (db: Database, f: AuthFixtures) => Promise<void>) =>
  withTestDatabase(async (db) => fn(db, await createAuthFixtures(db)));

const credencial = async (db: Database, memberId: string) =>
  (await db.select().from(credenciaisLavador).where(eq(credenciaisLavador.membroId, memberId)))[0];

/** Instância auth com relógio controlado pelo teste. */
function relogio(inicio = new Date()) {
  const clock = { t: inicio, avanca: (ms: number) => (clock.t = new Date(clock.t.getTime() + ms)) };
  return clock;
}

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('login PIN do lavador', () => {
  it('hash não guarda o PIN em texto puro e só o PIN certo entra', () =>
    run(async (db, f) => {
      const c = await credencial(db, f.a.membros.lavador.memberId);
      expect(c.pinHash).not.toContain(f.lavador.pin);
      expect(await verifySecret(f.lavador.pin, c.pinHash)).toBe(true);
      for (const pin of ['1230', '123', '0124', '00123']) {
        const res = await createHttp().post(PIN, { usuario: f.lavador.usuario, pin });
        expect(res.status, pin).toBe(401);
        expect(res.headers.getSetCookie()).toEqual([]);
      }
      expect((await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
    }));

  it('sucesso: cookie HttpOnly de 30 dias, contexto lavador do tenant do piloto e campos PIN fora da resposta', () =>
    run(async (_db, f) => {
      const http = createHttp();
      const res = await http.post(PIN, { usuario: '  LAVADOR.A ', pin: f.lavador.pin });
      expect(res.status).toBe(200);
      const raw = res.headers.getSetCookie().find((c) => c.includes('session_token='))!;
      expect(raw).toMatch(/HttpOnly/i);
      expect(raw).toMatch(/SameSite=Lax/i);
      expect(raw).toMatch(new RegExp(`Max-Age=${TRINTA_DIAS}`));
      const corpo = await res.text();
      expect(corpo).not.toMatch(/token|pin|hash/i);
      const m = f.a.membros.lavador;
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ tenantId: f.a.tenantId, userId: m.userId, memberId: m.memberId, perfil: 'lavador' });
      const sessao = await (await http.get('/get-session')).text();
      expect(sessao).toContain(m.userId);
      expect(sessao).not.toMatch(/pinMemberId|pinCredentialVersion|pin_hash|pinHash/);
    }));

  it('expira exatamente em 30 dias absolutos', () =>
    run(async (db, f) => {
      const clock = relogio();
      const auth = createAuth({ now: () => clock.t });
      const http = createHttp(auth.handler);
      expect((await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
      const [s] = await db.select().from(session).where(eq(session.userId, f.a.membros.lavador.userId));
      expect(s.createdAt.getTime()).toBe(clock.t.getTime());
      expect(s.expiresAt.getTime() - s.createdAt.getTime()).toBe(TRINTA_DIAS * 1000);
      const guard = (ms: number) =>
        createTenantGuards({ readSession: (h) => auth.api.getSession({ headers: h }), now: () => new Date(clock.t.getTime() + ms) }).requireTenantContext(http.headers());
      await expect(guard(TRINTA_DIAS * 1000 - 1)).resolves.toMatchObject({ perfil: 'lavador' });
      await expect(guard(TRINTA_DIAS * 1000)).rejects.toThrow('acesso negado');
    }));

  it('tenant vem do servidor: PIN de outro tenant falha e tenant no corpo é recusado', () =>
    run(async (_db, f) => {
      const res = await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pinB });
      expect(res.status).toBe(401);
      for (const extra of [{ tenantId: f.b.tenantId }, { organizationId: f.b.tenantId }, { slug: f.b.slug }]) {
        const r = await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pinB, ...extra });
        expect(r.status).toBe(400);
        expect(r.headers.getSetCookie()).toEqual([]);
      }
      for (const body of [{}, { usuario: f.lavador.usuario }, { usuario: f.lavador.usuario, pin: 123 }]) {
        expect((await createHttp().post(PIN, body)).status).toBe(400);
      }
    }));

  it('usuário desconhecido, inativo ou de formato inválido responde igual a PIN errado, com o mesmo trabalho de hash', () =>
    run(async (db, f) => {
      const verificados: string[] = [];
      const hasher: PinHasher = { hash: hashSecret, verify: (pin, hash) => (verificados.push(hash), verifySecret(pin, hash)) };
      const http = createHttp(createAuth({ hasher }).handler);
      const errado = await http.post(PIN, { usuario: f.lavador.usuario, pin: '9876' });
      const respostas = [{ status: errado.status, body: await errado.json() }];
      const real = verificados.splice(0)[0];

      const tentativas = [
        { usuario: 'ninguem', pin: f.lavador.pin },
        { usuario: 'ab', pin: f.lavador.pin },
        { usuario: f.lavador.usuario, pin: '12' },
      ];
      // inativo: o lavador de A é desativado depois
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, f.a.membros.lavador.memberId));
      tentativas.push({ usuario: f.lavador.usuario, pin: f.lavador.pin });
      for (const body of tentativas) {
        const res = await http.post(PIN, body);
        respostas.push({ status: res.status, body: await res.json() });
        expect(res.headers.getSetCookie()).toEqual([]);
        expect(verificados.splice(0), JSON.stringify(body)).toEqual([expect.stringMatching(new RegExp(`^[0-9a-f]{${real.split(':')[0].length}}:[0-9a-f]{${real.split(':')[1].length}}$`))]);
      }
      expect(new Set(respostas.map((r) => JSON.stringify(r))).size).toBe(1);
      expect(respostas[0]).toEqual({ status: 401, body: { code: 'INVALID_CREDENTIALS', message: INVALIDO } });
      // tentativa de inativo não mexe no contador
      expect((await credencial(db, f.a.membros.lavador.memberId)).errosConsecutivos).toBe(1);
    }));

  it('origem não confiável é recusada sem cookie', () =>
    run(async (_db, f) => {
      const res = await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin }, { origin: 'https://evil.example' });
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }));

  it('lavador não tem caminho e-mail/senha', () =>
    run(async (db, f) => {
      const { userId } = f.a.membros.lavador;
      expect(await db.select().from(account).where(eq(account.userId, userId))).toEqual([]);
      for (const password of [f.lavador.pin, f.senha, `${f.lavador.pin}0000`]) {
        const res = await createHttp().post('/sign-in/email', { email: `${userId}@lavador.invalid`, password });
        expect(res.status).toBe(401);
        expect(res.headers.getSetCookie()).toEqual([]);
      }
    }));
});

describe('bloqueio persistente', () => {
  it('quatro erros não bloqueiam; sucesso zera o contador', () =>
    run(async (db, f) => {
      const http = createHttp();
      for (let i = 0; i < 4; i++) expect((await http.post(PIN, { usuario: f.lavador.usuario, pin: '1111' })).status).toBe(401);
      expect((await credencial(db, f.a.membros.lavador.memberId)).errosConsecutivos).toBe(4);
      expect((await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
      expect(await credencial(db, f.a.membros.lavador.memberId)).toMatchObject({ errosConsecutivos: 0, bloqueadoAte: null });
    }));

  it('quinto erro bloqueia por 15 minutos; PIN certo continua bloqueado até o relógio liberar', () =>
    run(async (db, f) => {
      const clock = relogio();
      const http = createHttp(createAuth({ now: () => clock.t }).handler);
      for (let i = 0; i < 4; i++) await http.post(PIN, { usuario: f.lavador.usuario, pin: '1111' });
      const quinto = await http.post(PIN, { usuario: f.lavador.usuario, pin: '1111' });
      expect(quinto.status).toBe(429);
      expect(await quinto.json()).toMatchObject({ code: 'PIN_BLOCKED', message: expect.stringContaining('bloqueado') });
      expect(await credencial(db, f.a.membros.lavador.memberId)).toMatchObject({ errosConsecutivos: 5, bloqueadoAte: new Date(clock.t.getTime() + QUINZE_MIN) });

      clock.avanca(QUINZE_MIN - 1);
      const bloqueado = await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin });
      expect(bloqueado.status).toBe(429);
      expect(bloqueado.headers.getSetCookie()).toEqual([]);

      clock.avanca(1);
      expect((await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
      expect(await credencial(db, f.a.membros.lavador.memberId)).toMatchObject({ errosConsecutivos: 0, bloqueadoAte: null });
    }));

  it('depois do bloqueio expirar, o primeiro erro inicia série nova', () =>
    run(async (db, f) => {
      const clock = relogio();
      const http = createHttp(createAuth({ now: () => clock.t }).handler);
      for (let i = 0; i < 5; i++) await http.post(PIN, { usuario: f.lavador.usuario, pin: '1111' });
      clock.avanca(QUINZE_MIN);
      expect((await http.post(PIN, { usuario: f.lavador.usuario, pin: '1111' })).status).toBe(401);
      expect(await credencial(db, f.a.membros.lavador.memberId)).toMatchObject({ errosConsecutivos: 1, bloqueadoAte: null });
    }));

  it('cinco erros concorrentes deixam contador 5 e bloqueio; a sexta com PIN certo não autentica', () =>
    run(async (db, f) => {
      const res = await Promise.all(Array.from({ length: 5 }, () => createHttp().post(PIN, { usuario: f.lavador.usuario, pin: '1111' })));
      expect(res.map((r) => r.status).sort()).toEqual([401, 401, 401, 401, 429]);
      const c = await credencial(db, f.a.membros.lavador.memberId);
      expect(c.errosConsecutivos).toBe(5);
      expect(c.bloqueadoAte!.getTime()).toBeGreaterThan(Date.now());
      const sexta = await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin });
      expect(sexta.status).toBe(429);
      expect(sexta.headers.getSetCookie()).toEqual([]);
      expect(await db.select().from(session).where(eq(session.userId, f.a.membros.lavador.userId))).toEqual([]);
    }));

  it('nova instância auth no mesmo banco mantém o bloqueio', () =>
    run(async (_db, f) => {
      const primeira = createHttp(createAuth().handler);
      for (let i = 0; i < 5; i++) await primeira.post(PIN, { usuario: f.lavador.usuario, pin: '1111' });
      const reiniciada = createHttp(createAuth().handler);
      expect((await reiniciada.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(429);
    }));

  it('limite por origem é persistente, atômico e ignora x-forwarded-for do cliente', () =>
    run(async (_db, f) => {
      const ip = { 'x-real-ip': '203.0.113.7' };
      const tentativas = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          createHttp().post(PIN, { usuario: `ninguem${i}`, pin: '1111' }, { headers: { ...ip, 'x-forwarded-for': `198.51.100.${i}` } }),
        ),
      );
      expect(tentativas.every((r) => r.status === 401)).toBe(true);
      const reiniciada = createHttp(createAuth().handler);
      const excedida = await reiniciada.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin }, { headers: { ...ip, 'x-forwarded-for': '198.51.100.250' } });
      expect(excedida.status).toBe(429);
      expect(await excedida.json()).toMatchObject({ code: 'TOO_MANY_ATTEMPTS' });
      expect(excedida.headers.getSetCookie()).toEqual([]);
      // outro IP real segue com cota própria
      expect((await createHttp().post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin }, { headers: { 'x-real-ip': '203.0.113.8' } })).status).toBe(200);
    }));
});

describe('versão da credencial na sessão', () => {
  it('reset entre a verificação do hash e a emissão: sessão com versão antiga é negada no primeiro acesso', () =>
    run(async (db, f) => {
      let chegou!: () => void;
      let libera!: () => void;
      const verificou = new Promise<void>((r) => (chegou = r));
      const portao = new Promise<void>((r) => (libera = r));
      const http = createHttp(createAuth({ aposVerificar: async () => (chegou(), portao) }).handler);
      const login = http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin });
      await verificou;
      await db
        .update(credenciaisLavador)
        .set({ pinHash: await hashSecret('4321'), versao: sql`${credenciaisLavador.versao} + 1` })
        .where(eq(credenciaisLavador.membroId, f.a.membros.lavador.memberId));
      libera();
      const res = await login;
      if (res.headers.getSetCookie().length > 0) await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
      else expect(res.status).not.toBe(200);
      // o PIN novo funciona e passa no guard
      const nova = createHttp();
      expect((await nova.post(PIN, { usuario: f.lavador.usuario, pin: '4321' })).status).toBe(200);
      await expect(requireTenantContext(nova.headers())).resolves.toMatchObject({ perfil: 'lavador' });
    }));

  it('reset depois do login derruba a sessão PIN; sessão de lavador sem versão PIN é negada', () =>
    run(async (db, f) => {
      const http = createHttp();
      await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin });
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ perfil: 'lavador' });
      await db.update(credenciaisLavador).set({ versao: 2 }).where(eq(credenciaisLavador.membroId, f.a.membros.lavador.memberId));
      await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
      await db.update(credenciaisLavador).set({ versao: 1 }).where(eq(credenciaisLavador.membroId, f.a.membros.lavador.memberId));
      await expect(requireTenantContext(http.headers())).resolves.toMatchObject({ perfil: 'lavador' });
      await db.update(session).set({ pinCredentialVersion: null, pinMemberId: null }).where(eq(session.userId, f.a.membros.lavador.userId));
      await expect(requireTenantContext(http.headers())).rejects.toThrow('acesso negado');
    }));

  it('PIN, hash e token nunca vão para o log', () =>
    run(async (db, f) => {
      const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
      try {
        const http = createHttp();
        await http.post(PIN, { usuario: f.lavador.usuario, pin: '1111' });
        await http.post(PIN, { usuario: 'ninguem', pin: '2222' });
        await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin });
        const logged = JSON.stringify(espioes.flatMap((s) => s.mock.calls));
        const { pinHash } = await credencial(db, f.a.membros.lavador.memberId);
        const token = http.cookie().match(/session_token=([^;.]+)/)![1];
        for (const segredo of [pinHash, token, f.lavador.pin, '1111', '2222']) expect(logged).not.toContain(segredo);
      } finally {
        espioes.forEach((s) => s.mockRestore());
      }
    }));
});
