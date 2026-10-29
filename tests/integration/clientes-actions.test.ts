import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTenantGuards } from '@/lib/auth/context';
import { getDatabase } from '@/lib/db/client';
import { clientes, portes, session, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { buscarVeiculoPorPlaca } from '@/modules/clientes/clientes.repo';
import { cadastroRapidoAction, salvarClienteAction, salvarVeiculoAction } from '@/modules/clientes/clientes.actions';
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
async function comoLavador(f: AuthFixtures) {
  const http = createHttp();
  expect((await http.post('/lavador-pin/sign-in', { usuario: f.lavador.usuario, pin: f.lavador.pin })).status).toBe(200);
  req.headers = http.headers();
}
const porteDe = async (db: Database, tenantId: string, nome = 'Médio') => (await db.insert(portes).values({ tenantId, nome }).returning())[0];
const tudo = async (db: Database) => JSON.stringify(await Promise.all([clientes, veiculos].map(async (t) => (await db.execute(sql`select * from ${t} order by id`)).rows)));

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('clientes.actions', () => {
  it('dono, gerente e recepção cadastram e editam cliente e veículo; telefone vira E.164', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      for (const [i, quem] of [f.a.membros.dono, f.a.membros.gerente, f.a.membros.recepcao].entries()) {
        await como(f, quem.userId);
        const c = await salvarClienteAction({ nome: ' Maria ', telefone: '(11) 98888-7777' });
        if (!c.ok) throw new Error('falhou');
        expect(c.data).toMatchObject({ nome: 'Maria', telefone: '+5511988887777' });
        const placa = `AB${'CDE'[i]}-1234`;
        const v = await salvarVeiculoAction({ placa, porteId: porte.id, clienteId: c.data.id });
        expect(v).toMatchObject({ ok: true, data: { placa: placa.replace('-', ''), clienteId: c.data.id } });
        expect(await salvarClienteAction({ id: c.data.id, nome: 'Maria S.' })).toMatchObject({ ok: true, data: { nome: 'Maria S.', telefone: '+5511988887777' } });
        if (!v.ok) throw new Error('falhou');
        expect(await salvarVeiculoAction({ id: v.data.id, placa: v.data.placa, porteId: porte.id, modelo: 'Gol', clienteId: null })).toMatchObject({ ok: true, data: { modelo: 'Gol', clienteId: null } });
      }
    }));

  it('telefone ou placa inválidos são erro de campo, não exceção; placa duplicada recusada', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      await como(f, f.a.membros.dono.userId);
      expect(await salvarClienteAction({ nome: 'X', telefone: '123' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { telefone: ['Telefone inválido. Use DDD + número.'] } });
      expect(await salvarVeiculoAction({ placa: 'ab12', porteId: porte.id })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { placa: expect.any(Array) } });
      expect(await salvarClienteAction({ nome: 'X', tenantId: f.b.tenantId })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await salvarVeiculoAction({ placa: 'ABC1234', porteId: porte.id })).toMatchObject({ ok: true });
      expect(await salvarVeiculoAction({ placa: 'abc-1234', porteId: porte.id })).toMatchObject({ ok: false, code: 'PLACA_DUPLICADA' });
    }));

  it('lavador não chama salvarClienteAction nem salvarVeiculoAction (nem sem sessão)', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        for (const entrar of [() => comoLavador(f), async () => void (req.headers = new Headers())]) {
          await entrar();
          const antes = await tudo(db);
          expect(await salvarClienteAction({ nome: 'X' })).toEqual(NEGADO);
          expect(await salvarVeiculoAction({ placa: 'ABC1234', porteId: porte.id })).toEqual(NEGADO);
          expect(await tudo(db)).toBe(antes);
        }
      } finally {
        warn.mockRestore();
      }
    }));

  it('placa duplicada no tenant retorna o veículo existente', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      const a = await cadastroRapidoAction({ placa: 'abc-1d23', porteId: porte.id, clienteNome: 'Ana' });
      const b = await cadastroRapidoAction({ placa: 'ABC1D23', porteId: porte.id, clienteNome: 'Outra' });
      if (!a.ok || !b.ok) throw new Error('falhou');
      expect(b.data).toEqual(a.data);
      expect(await db.select().from(veiculos)).toHaveLength(1);
      expect(await db.select().from(clientes)).toHaveLength(1);
    }));

  it('lavador cria veículo novo mas cadastroRapido não altera cliente nem veículo existentes', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      const outro = await porteDe(db, f.a.tenantId, 'Grande');
      const [cli] = await db.insert(clientes).values({ tenantId: f.a.tenantId, nome: 'Original', telefone: '+5511900000000' }).returning();
      await db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: 'AAA1111', porteId: porte.id, modelo: 'Fusca', clienteId: cli.id });
      await comoLavador(f);

      const novo = await cadastroRapidoAction({ placa: 'bbb-2c22', porteId: porte.id, modelo: 'Uno', clienteNome: 'Novo', telefone: '11 97777-6666' });
      if (!novo.ok) throw new Error('falhou');
      expect(novo.data.clienteId).not.toBeNull();
      const [v] = await db.select().from(veiculos).where(eq(veiculos.id, novo.data.veiculoId));
      expect(v).toMatchObject({ placa: 'BBB2C22', modelo: 'Uno', clienteId: novo.data.clienteId });
      const [c] = await db.select().from(clientes).where(eq(clientes.id, novo.data.clienteId!));
      expect(c).toMatchObject({ nome: 'Novo', telefone: '+5511977776666' });

      const antes = await tudo(db);
      const r = await cadastroRapidoAction({ placa: 'AAA1111', porteId: outro.id, modelo: 'Outro', clienteNome: 'Invasor', telefone: '11 95555-4444' });
      expect(r).toEqual({ ok: true, data: { veiculoId: expect.any(String), clienteId: cli.id } });
      expect(await tudo(db)).toBe(antes);
    }));

  it('cadastroRapido: telefone sem nome e porte de outro tenant são recusados', () =>
    run(async (db, f) => {
      const porteB = await porteDe(db, f.b.tenantId);
      const porte = await porteDe(db, f.a.tenantId);
      await comoLavador(f);
      expect(await cadastroRapidoAction({ placa: 'ABC1234', porteId: porte.id, telefone: '11988887777' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { clienteNome: expect.any(Array) } });
      expect(await cadastroRapidoAction({ placa: 'ABC1234', porteId: porteB.id })).toEqual({ ok: false, code: 'NAO_ENCONTRADO', message: 'Porte não encontrado.' });
      expect(await db.select().from(veiculos)).toHaveLength(0);
    }));

  it('isolamento de tenant: ids e placas do outro tenant nunca são lidos nem gravados', () =>
    run(async (db, f) => {
      const porteA = await porteDe(db, f.a.tenantId);
      const porteB = await porteDe(db, f.b.tenantId);
      const [cliB] = await db.insert(clientes).values({ tenantId: f.b.tenantId, nome: 'Do B' }).returning();
      const [veiB] = await db.insert(veiculos).values({ tenantId: f.b.tenantId, placa: 'BBB1B11', porteId: porteB.id, clienteId: cliB.id }).returning();
      await como(f, f.a.membros.dono.userId);
      const antes = await tudo(db);
      expect(await salvarClienteAction({ id: cliB.id, nome: 'Invadido' })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await salvarVeiculoAction({ id: veiB.id, placa: 'BBB1B11', porteId: porteA.id })).toMatchObject({ ok: false });
      expect(await salvarVeiculoAction({ placa: 'AAA1A11', porteId: porteB.id })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await salvarVeiculoAction({ placa: 'AAA1A11', porteId: porteA.id, clienteId: cliB.id })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await tudo(db)).toBe(antes);
      // a mesma placa em outro tenant é veículo novo, e a busca não enxerga a do B
      expect(await salvarVeiculoAction({ placa: 'BBB1B11', porteId: porteA.id })).toMatchObject({ ok: true });
      const [s] = await db.insert(session).values({ userId: f.a.membros.dono.userId, activeOrganizationId: f.a.tenantId, expiresAt: new Date(Date.now() + 3_600_000), token: crypto.randomUUID() }).returning();
      const ctxA = await createTenantGuards({
        readSession: async () => ({ session: { id: s.id, userId: s.userId, expiresAt: s.expiresAt, activeOrganizationId: f.a.tenantId } }),
        database: db,
      }).requireTenantContext(new Headers());
      const achado = await buscarVeiculoPorPlaca(ctxA, 'bbb-1b11', db);
      expect(achado?.veiculo.porteId).toBe(porteA.id);
      expect(achado?.cliente).toBeNull();
      expect(await buscarVeiculoPorPlaca(ctxA, 'zzz', db)).toBeNull();
    }));

  it('resposta ao lavador não contém campos monetários', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      await comoLavador(f);
      const r = await cadastroRapidoAction({ placa: 'ABC1234', porteId: porte.id, clienteNome: 'Ana' });
      expect(Object.keys((r as { data: object }).data).sort()).toEqual(['clienteId', 'veiculoId']);
      expect(JSON.stringify(r)).not.toMatch(/centavos|valor|total|preco|R\$/i);
    }));
});
