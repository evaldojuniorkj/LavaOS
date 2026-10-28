import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { verifySecret } from '@/lib/auth/credentials';
import { requireTenantContext } from '@/lib/auth/context';
import { getDatabase } from '@/lib/db/client';
import { account, credenciaisLavador, membros, session, user } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { createMemberAction, deactivateMemberAction, resetPinAction } from '@/modules/equipe/equipe.actions';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { testUrls, withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

// Actions reais com o guard real: o cookie de login HTTP vira os headers do request do Next.
const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };
const PIN = '/lavador-pin/sign-in';

const run = (fn: (db: Database, f: AuthFixtures) => Promise<void>) =>
  withTestDatabase(async (db) => fn(db, await createAuthFixtures(db)));

async function como(f: AuthFixtures, userId: string) {
  const http = createHttp();
  expect((await http.post('/sign-in/email', { email: f.emailDe(userId), password: f.senha })).status).toBe(200);
  req.headers = http.headers();
  return http;
}

async function comoLavador(f: AuthFixtures) {
  const http = createHttp();
  expect((await http.post(PIN, { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
  req.headers = http.headers();
  return http;
}

/** Estado inteiro das tabelas de identidade/equipe: recusa não pode mudar nada. */
const estado = async (db: Database) =>
  JSON.stringify(
    await Promise.all([user, account, membros, credenciaisLavador, session].map(async (t) => (await db.execute(sql`select * from ${t} order by id`)).rows)),
  );

const novoEmail = () => `${crypto.randomUUID()}@teste.invalid`;

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('criação de membros', () => {
  it('gerente cria recepção (conta credential) e lavador (identidade técnica + PIN); resumo sem segredos', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.gerente.userId);
      const email = novoEmail();
      const senha = `senha-${crypto.randomUUID()}`;
      const r = await createMemberAction({ perfil: 'recepcao', nomeExibicao: ' Ana ', email: email.toUpperCase(), senha });
      expect(r).toEqual({ ok: true, data: { id: expect.any(String), nomeExibicao: 'Ana', perfil: 'recepcao', ativo: true } });
      if (!r.ok || !r.data) throw new Error('falhou');
      expect(JSON.stringify(r)).not.toContain(senha);
      const [m] = await db.select().from(membros).where(eq(membros.id, r.data.id));
      expect(m.tenantId).toBe(f.a.tenantId);
      const [u] = await db.select().from(user).where(eq(user.id, m.userId));
      expect(u.email).toBe(email); // minúsculo: o login do Better Auth normaliza assim
      const contas = await db.select().from(account).where(eq(account.userId, m.userId));
      expect(contas).toHaveLength(1);
      expect(contas[0]).toMatchObject({ providerId: 'credential', accountId: m.userId });
      expect(contas[0].password).not.toContain(senha);
      expect(await verifySecret(senha, contas[0].password!)).toBe(true);
      const recepcao = createHttp();
      expect((await recepcao.post('/sign-in/email', { email, password: senha })).status).toBe(200);
      await expect(requireTenantContext(recepcao.headers())).resolves.toMatchObject({ tenantId: f.a.tenantId, perfil: 'recepcao' });

      const l = await createMemberAction({ perfil: 'lavador', nomeExibicao: 'Beto', usuario: ' Beto.Lava ', pin: '0456' });
      expect(l).toEqual({ ok: true, data: { id: expect.any(String), nomeExibicao: 'Beto', perfil: 'lavador', ativo: true } });
      if (!l.ok || !l.data) throw new Error('falhou');
      expect(JSON.stringify(l)).not.toContain('0456');
      const [ml] = await db.select().from(membros).where(eq(membros.id, l.data.id));
      const [ul] = await db.select().from(user).where(eq(user.id, ml.userId));
      expect(ul.email).toBe(`${ml.userId}@lavador.invalid`);
      expect(await db.select().from(account).where(eq(account.userId, ml.userId))).toEqual([]);
      const [c] = await db.select().from(credenciaisLavador).where(eq(credenciaisLavador.membroId, ml.id));
      expect(c).toMatchObject({ tenantId: f.a.tenantId, usuarioNormalizado: 'beto.lava', versao: 1, errosConsecutivos: 0 });
      expect(c.pinHash).not.toContain('0456');
      const lav = createHttp();
      expect((await lav.post(PIN, { usuario: 'beto.lava', pin: '0456' })).status).toBe(200);
      await expect(requireTenantContext(lav.headers())).resolves.toMatchObject({ memberId: ml.id, perfil: 'lavador' });
    }));

  it('criar gerente ou dono exige dono', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.gerente.userId);
      const antes = await estado(db);
      for (const perfil of ['gerente', 'dono'] as const) {
        expect(await createMemberAction({ perfil, nomeExibicao: 'X', email: novoEmail(), senha: 'senha-forte-1' })).toEqual(NEGADO);
      }
      expect(await estado(db)).toBe(antes);
      await como(f, f.a.membros.dono.userId);
      for (const perfil of ['gerente', 'dono'] as const) {
        const r = await createMemberAction({ perfil, nomeExibicao: 'Líder', email: novoEmail(), senha: 'senha-forte-1' });
        expect(r).toMatchObject({ ok: true, data: { perfil } });
      }
    }));

  it('conflito de identidade não reassocia conta nem troca senha', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const antes = await estado(db);
      for (const email of [f.emailDe(f.a.membros.gerente.userId), f.emailDe(f.b.membros.dono.userId).toUpperCase()]) {
        const r = await createMemberAction({ perfil: 'recepcao', nomeExibicao: 'Outro', email, senha: 'senha-nova-123' });
        expect(r).toEqual({ ok: false, code: 'IDENTIDADE_EM_USO', message: 'Este e-mail já está em uso.' });
      }
      const r = await createMemberAction({ perfil: 'lavador', nomeExibicao: 'Outro', usuario: f.lavador.usuario, pin: '5555' });
      expect(r).toEqual({ ok: false, code: 'IDENTIDADE_EM_USO', message: 'Este usuário já está em uso.' });
      expect(await estado(db)).toBe(antes);
      expect((await createHttp().post('/sign-in/email', { email: f.emailDe(f.a.membros.gerente.userId), password: f.senha })).status).toBe(200);
    }));

  it('falha ao criar vínculo ou credencial não deixa user/conta/credencial órfão nem vaza segredo', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const espioes = (['log', 'info', 'warn', 'error', 'debug'] as const).map((k) => vi.spyOn(console, k).mockImplementation(() => {}));
      const owner = new Pool({ connectionString: testUrls.owner, max: 1 });
      try {
        await owner.query(`create function falha_teste() returns trigger language plpgsql as $$ begin raise exception 'falha simulada'; end $$`);
        for (const [tabela, input] of [
          ['membros', { perfil: 'recepcao', nomeExibicao: 'Órfão', email: novoEmail(), senha: 'senha-secreta-1' }],
          ['membros', { perfil: 'lavador', nomeExibicao: 'Órfão', usuario: 'orfao', pin: '8642' }],
          ['credenciais_lavador', { perfil: 'lavador', nomeExibicao: 'Órfão', usuario: 'orfao', pin: '8642' }],
        ] as const) {
          await owner.query(`create trigger falha_teste before insert on ${tabela} for each row execute function falha_teste()`);
          const antes = await estado(db);
          const r = await createMemberAction(input);
          expect(r).toEqual({ ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' });
          expect(await estado(db)).toBe(antes);
          await owner.query(`drop trigger falha_teste on ${tabela}`);
        }
        const logged = JSON.stringify(espioes.flatMap((s) => s.mock.calls));
        for (const segredo of ['senha-secreta-1', '8642']) expect(logged).not.toContain(segredo);
        expect(logged).not.toMatch(/[0-9a-f]{32}:[0-9a-f]{128}/); // hash scrypt (salt:chave)
      } finally {
        await owner.end();
        espioes.forEach((s) => s.mockRestore());
      }
    }));
});

describe('autorização e isolamento', () => {
  it('recepção, lavador e anônimo recebem acesso negado em cada action, sem efeito e com log', () =>
    run(async (db, f) => {
      const alvo = f.a.membros.lavador.memberId;
      const acoes = [
        () => createMemberAction({ perfil: 'lavador', nomeExibicao: 'X', usuario: 'novo.x', pin: '1234' }),
        () => createMemberAction({ perfil: 'recepcao', nomeExibicao: 'X', email: novoEmail(), senha: 'senha-forte-1' }),
        () => deactivateMemberAction({ memberId: alvo }),
        () => resetPinAction({ memberId: alvo, pin: '4321' }),
      ];
      for (const entrar of [() => como(f, f.a.membros.recepcao.userId), () => comoLavador(f), async () => (req.headers = new Headers())]) {
        await entrar();
        const antes = await estado(db);
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
          for (const acao of acoes) expect(await acao()).toEqual(NEGADO);
          expect(warn).toHaveBeenCalledTimes(acoes.length);
          expect(warn.mock.calls.every(([msg]) => msg === '[auth] acesso negado')).toBe(true);
        } finally {
          warn.mockRestore();
        }
        expect(await estado(db)).toBe(antes);
      }
    }));

  it('gerente não controla liderança: desativar ou resetar dono/gerente é negado', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.gerente.userId);
      const antes = await estado(db);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (const alvo of [f.a.membros.dono.memberId, f.a.membros.gerente.memberId]) {
          expect(await deactivateMemberAction({ memberId: alvo })).toEqual(NEGADO);
          expect(await resetPinAction({ memberId: alvo, pin: '4321' })).toEqual(NEGADO);
        }
        expect(warn).toHaveBeenCalledTimes(4);
      } finally {
        warn.mockRestore();
      }
      expect(await estado(db)).toBe(antes);
      // PIN de liderança não existe, nem para o dono
      await como(f, f.a.membros.dono.userId);
      expect(await resetPinAction({ memberId: f.a.membros.gerente.memberId, pin: '4321' })).toEqual({ ok: false, code: 'SEM_PIN', message: 'Só lavador tem PIN.' });
    }));

  it('contexto A não desativa nem reseta alvo de B; criação fica sempre no tenant A', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const antes = await estado(db);
      const fora = { ok: false, code: 'NAO_ENCONTRADO', message: 'Membro não encontrado.' };
      for (const alvo of [f.b.membros.lavador.memberId, f.b.membros.recepcao.memberId, f.multi.memberIdB, crypto.randomUUID()]) {
        expect(await deactivateMemberAction({ memberId: alvo })).toEqual(fora);
        expect(await resetPinAction({ memberId: alvo, pin: '4321' })).toEqual(fora);
      }
      expect(await estado(db)).toBe(antes);
      const r = await createMemberAction({ perfil: 'lavador', nomeExibicao: 'X', usuario: f.lavador.usuario + '2', pin: '1234' });
      if (!r.ok || !r.data) throw new Error('falhou');
      expect((await db.select().from(membros).where(eq(membros.id, r.data.id)))[0].tenantId).toBe(f.a.tenantId);
    }));

  it('entrada adulterada é recusada pelo schema estrito sem efeito no banco', () =>
    run(async (db, f) => {
      await como(f, f.a.membros.dono.userId);
      const antes = await estado(db);
      const staff = { perfil: 'recepcao', nomeExibicao: 'X', email: novoEmail(), senha: 'senha-forte-1' };
      const lav = { perfil: 'lavador', nomeExibicao: 'X', usuario: 'novo.x', pin: '1234' };
      const alvo = f.a.membros.lavador.memberId;
      const criacoes: unknown[] = [
        { ...staff, tenant_id: f.b.tenantId },
        { ...staff, tenantId: f.b.tenantId },
        { ...lav, organizationId: f.b.tenantId },
        { ...staff, perfil: 'admin' },
        { ...staff, perfil: 'owner' },
        { ...lav, senha: 'senha-forte-1' },
        { ...staff, pin: '1234' },
        { ...lav, pin: '123' },
        { ...lav, pin: 1234 },
        { ...lav, usuario: 'a b' },
        { ...staff, senha: 'curta' },
        { ...staff, email: 'nao-e-email' },
        null,
        'texto',
      ];
      for (const input of criacoes) {
        const r = await createMemberAction(input);
        expect(r, JSON.stringify(input)).toMatchObject({ ok: false, code: 'VALIDACAO', message: 'Dados inválidos.' });
      }
      expect(await createMemberAction({ ...lav, pin: '123' })).toMatchObject({ fieldErrors: { pin: ['O PIN deve ter de 4 a 6 dígitos.'] } });
      for (const input of [{ memberId: alvo, perfil: 'dono' }, { memberId: alvo, tenantId: f.b.tenantId }, { memberId: 'nao-e-uuid' }, {}]) {
        expect(await deactivateMemberAction(input)).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
      for (const input of [{ memberId: alvo, pin: '12' }, { memberId: alvo, pin: '1234', versao: 1 }, { memberId: alvo }]) {
        expect(await resetPinAction(input)).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
      expect(await estado(db)).toBe(antes);
    }));
});
