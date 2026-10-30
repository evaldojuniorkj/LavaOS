import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { createTenantGuards } from '@/lib/auth/context';
import { getDatabase } from '@/lib/db/client';
import { clientes, portes, session, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { buscarVeiculoPorPlaca } from '@/modules/clientes/clientes.repo';
import { buscarPorPlacaAction, cadastroRapidoAction, salvarClienteAction, salvarTelefoneClienteAction, salvarVeiculoAction } from '@/modules/clientes/clientes.actions';
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
      expect(novo.data).not.toHaveProperty('clienteId'); // lavador não recebe ids de cliente
      const [v] = await db.select().from(veiculos).where(eq(veiculos.id, novo.data.veiculoId));
      expect(v).toMatchObject({ placa: 'BBB2C22', modelo: 'Uno', clienteId: expect.any(String) });
      const [c] = await db.select().from(clientes).where(eq(clientes.id, v.clienteId!));
      expect(c).toMatchObject({ nome: 'Novo', telefone: '+5511977776666' });

      const antes = await tudo(db);
      const r = await cadastroRapidoAction({ placa: 'AAA1111', porteId: outro.id, modelo: 'Outro', clienteNome: 'Invasor', telefone: '11 95555-4444' });
      expect(r).toEqual({ ok: true, data: { veiculoId: expect.any(String) } });
      expect(await tudo(db)).toBe(antes);
      await como(f, f.a.membros.recepcao.userId);
      expect(await cadastroRapidoAction({ placa: 'AAA1111', porteId: outro.id })).toEqual({ ok: true, data: { veiculoId: expect.any(String), clienteId: cli.id } });
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
      expect(Object.keys((r as { data: object }).data).sort()).toEqual(['veiculoId']);
      expect(JSON.stringify(r)).not.toMatch(/centavos|valor|total|preco|R\$/i);
    }));

  it('placa duplicada: criar, trocar a placa para a de outro veículo e corrida viram PLACA_DUPLICADA', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      await como(f, f.a.membros.dono.userId);
      const a = await salvarVeiculoAction({ placa: 'AAA1111', porteId: porte.id });
      const b = await salvarVeiculoAction({ placa: 'BBB2222', porteId: porte.id });
      if (!a.ok || !b.ok) throw new Error('falhou');
      expect(await salvarVeiculoAction({ id: b.data.id, placa: 'aaa-1111', porteId: porte.id })).toEqual({ ok: false, code: 'PLACA_DUPLICADA', message: 'Já existe um veículo com esta placa.' });
      const corrida = await Promise.all([1, 2].map(() => salvarVeiculoAction({ placa: 'CCC3333', porteId: porte.id })));
      expect(corrida.filter((r) => r.ok)).toHaveLength(1);
      expect(corrida.find((r) => !r.ok)).toEqual({ ok: false, code: 'PLACA_DUPLICADA', message: 'Já existe um veículo com esta placa.' });
      expect(await db.select().from(veiculos)).toHaveLength(3);
    }));

  it('cadastroRapido concorrente com a mesma placa nova: um veículo, um cliente, sem órfão', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      await comoLavador(f);
      const rs = await Promise.all(['Ana', 'Beto'].map((clienteNome) => cadastroRapidoAction({ placa: 'ABC1D23', porteId: porte.id, clienteNome })));
      if (!rs[0].ok || !rs[1].ok) throw new Error('falhou');
      expect(rs[1].data).toEqual(rs[0].data);
      const [v] = await db.select().from(veiculos);
      expect(await db.select().from(veiculos)).toHaveLength(1);
      const cs = await db.select().from(clientes);
      expect(cs).toHaveLength(1);
      expect(v.clienteId).toBe(cs[0].id);
    }));

  it('buscarPorPlacaAction: lavador vê só o nome do cliente (sem clienteId); recepção vê tudo; outro tenant e inválida dão null', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      const porteB = await porteDe(db, f.b.tenantId);
      const [cli] = await db.insert(clientes).values({ tenantId: f.a.tenantId, nome: 'Ana', telefone: '+5511988887777', observacoes: 'vip' }).returning();
      await db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: 'AAA1111', porteId: porte.id, clienteId: cli.id });
      await db.insert(veiculos).values({ tenantId: f.b.tenantId, placa: 'BBB2222', porteId: porteB.id });

      await comoLavador(f);
      const l = await buscarPorPlacaAction({ placa: 'aaa-1111' });
      if (!l.ok || !l.data) throw new Error('falhou');
      expect(l.data.cliente).toEqual({ nome: 'Ana' });
      // varredura recursiva: nenhuma chave de cliente (id, telefone, observações) em nível nenhum da resposta
      const chaves = (v: unknown): string[] => (v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : []);
      expect(chaves(l).filter((k) => /cliente|telefone|observacoes/i.test(k))).toEqual(['cliente']);
      expect(JSON.stringify(l)).not.toContain(cli.id);
      expect(JSON.stringify(l)).not.toMatch(/telefone|observacoes|vip|9888/);
      expect(await buscarPorPlacaAction({ placa: 'BBB2222' })).toEqual({ ok: true, data: null });
      expect(await buscarPorPlacaAction({ placa: 'xx' })).toEqual({ ok: true, data: null });
      expect(await buscarPorPlacaAction({ placa: 'AAA1111', tenantId: f.b.tenantId })).toMatchObject({ ok: false, code: 'VALIDACAO' });

      await como(f, f.a.membros.recepcao.userId);
      const r = await buscarPorPlacaAction({ placa: 'AAA1111' });
      expect(r).toMatchObject({ ok: true, data: { veiculo: { clienteId: cli.id }, cliente: { id: cli.id, nome: 'Ana', telefone: '+5511988887777', observacoes: 'vip' } } });
      expect(await buscarPorPlacaAction({ placa: 'BBB2222' })).toEqual({ ok: true, data: null });
    }));

  it('salvarTelefoneClienteAction: normaliza, recusa telefone inválido/campo extra, lavador e outro tenant', () =>
    run(async (db, f) => {
      const [cli] = await db.insert(clientes).values({ tenantId: f.a.tenantId, nome: 'Ana', observacoes: 'vip' }).returning();
      const [cliB] = await db.insert(clientes).values({ tenantId: f.b.tenantId, nome: 'Do B' }).returning();
      const telefones = async () => (await db.select({ nome: clientes.nome, telefone: clientes.telefone }).from(clientes)).map((c) => `${c.nome}:${c.telefone}`).sort();

      await comoLavador(f);
      expect(await salvarTelefoneClienteAction({ clienteId: cli.id, telefone: '11988887777' })).toEqual(NEGADO);

      await como(f, f.a.membros.recepcao.userId);
      expect(await salvarTelefoneClienteAction({ clienteId: cli.id, telefone: '123' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { telefone: ['Telefone inválido. Use DDD + número.'] } });
      expect(await salvarTelefoneClienteAction({ clienteId: cli.id, telefone: '' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { telefone: ['Informe o telefone.'] } });
      expect(await salvarTelefoneClienteAction({ clienteId: cli.id, telefone: '11988887777', nome: 'X' })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await salvarTelefoneClienteAction({ clienteId: cliB.id, telefone: '11988887777' })).toMatchObject({ ok: false, code: 'NAO_ENCONTRADO' });
      expect(await telefones()).toEqual(['Ana:null', 'Do B:null']);

      expect(await salvarTelefoneClienteAction({ clienteId: cli.id, telefone: '(11) 98888-7777' })).toMatchObject({ ok: true, data: { nome: 'Ana', telefone: '+5511988887777', observacoes: 'vip' } });
      expect(await telefones()).toEqual(['Ana:+5511988887777', 'Do B:null']);
    }));

  it('cadastroRapido sem placa: modelo obrigatório, placa+semPlaca recusado, dois sem placa coexistem e a busca nunca os devolve', () =>
    run(async (db, f) => {
      const porte = await porteDe(db, f.a.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      expect(await cadastroRapidoAction({ semPlaca: true, porteId: porte.id })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { modelo: [expect.stringMatching(/modelo/i)] } });
      expect(await cadastroRapidoAction({ semPlaca: true, porteId: porte.id, modelo: 'X' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { modelo: expect.any(Array) } });
      expect(await cadastroRapidoAction({ semPlaca: true, placa: 'ABC1234', modelo: 'CG 160', porteId: porte.id })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      const a = await cadastroRapidoAction({ semPlaca: true, modelo: 'CG 160', porteId: porte.id, clienteNome: 'Zé' });
      const b = await cadastroRapidoAction({ semPlaca: true, modelo: 'Biz', porteId: porte.id });
      if (!a.ok || !b.ok) throw new Error('falhou');
      expect(a.data.veiculoId).not.toBe(b.data.veiculoId);
      expect(await db.select().from(veiculos)).toMatchObject([{ placa: null }, { placa: null }]);
      expect(await buscarPorPlacaAction({ placa: '' })).toEqual({ ok: true, data: null });
      expect(await buscarPorPlacaAction({ placa: 'null' })).toEqual({ ok: true, data: null });
      await comoLavador(f);
      const c = await cadastroRapidoAction({ semPlaca: true, modelo: 'Pop 110', porteId: porte.id, clienteNome: 'Y' });
      expect(c).toEqual({ ok: true, data: { veiculoId: expect.any(String) } }); // sem clienteId para o lavador
    }));
});
