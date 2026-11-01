import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { clientes, membros, ordensServico, osContadores, osEventos, osItens, portes, precos, servicos, user, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { abrirOsAction } from '@/modules/ordens/ordens.actions';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { createHttp } from '../helpers/http';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

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

/** Catálogo de um tenant: Lavagem (principal) e Cera (adicional) com preço no Médio; Polimento só tem preço no Grande. */
async function semear(db: Database, tenantId: string, placa = 'ABC1D23') {
  const [medio, grande] = await db.insert(portes).values([{ tenantId, nome: 'Médio' }, { tenantId, nome: 'Grande' }]).returning();
  const [lavagem, cera, polimento, inativo] = await db
    .insert(servicos)
    .values([
      { tenantId, nome: 'Lavagem', comissaoTipo: 'percentual', comissaoValor: 3000 },
      { tenantId, nome: 'Cera', adicional: true, comissaoTipo: 'fixo', comissaoValor: 500 },
      { tenantId, nome: 'Polimento', comissaoTipo: 'percentual', comissaoValor: 1000 },
      { tenantId, nome: 'Antigo', ativo: false, comissaoTipo: 'percentual', comissaoValor: 1000 },
    ])
    .returning();
  await db.insert(precos).values([
    { tenantId, servicoId: lavagem.id, porteId: medio.id, valorCentavos: 5000 },
    { tenantId, servicoId: cera.id, porteId: medio.id, valorCentavos: 1500 },
    { tenantId, servicoId: polimento.id, porteId: grande.id, valorCentavos: 9000 },
    { tenantId, servicoId: inativo.id, porteId: medio.id, valorCentavos: 100 },
  ]);
  const [cliente] = await db.insert(clientes).values({ tenantId, nome: 'Ana', telefone: '+5511988887777' }).returning();
  const [veiculo] = await db.insert(veiculos).values({ tenantId, placa, porteId: medio.id, modelo: 'Gol', cor: 'Prata', clienteId: cliente.id }).returning();
  return { medio, lavagem, cera, polimento, inativo, veiculo, cliente };
}

const contagem = async (db: Database) => (await db.execute(sql`select (select count(*) from ordens_servico) + (select count(*) from os_itens) + (select count(*) from os_eventos) as n`)).rows[0].n;
const chaves = (v: unknown): string[] => (v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : []);

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('abrirOsAction', () => {
  it('abre OS com itens e totais vindos do banco', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      const r = await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id, s.cera.id], observacoes: ' risco na porta ' });
      if (!r.ok) throw new Error(JSON.stringify(r));
      expect(r.data).toMatchObject({
        numero: 1,
        status: 'aguardando',
        subtotalCentavos: 6500,
        descontoCentavos: 0,
        acrescimoCentavos: 0,
        totalCentavos: 6500,
        observacoes: 'risco na porta',
        veiculo: { placa: 'ABC1D23', modelo: 'Gol', cor: 'Prata' },
        cliente: { nome: 'Ana', telefone: '+5511988887777' },
        responsavel: null,
        inicioLavagemEm: null,
      });
      expect(r.data).toHaveProperty('tokenPublico', expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
      const [os] = await db.select().from(ordensServico);
      expect(os).toMatchObject({ tenantId: f.a.tenantId, clienteId: s.cliente.id, abertaPor: f.a.membros.recepcao.memberId, responsavelId: null, atribuidoEm: null, totalCentavos: 6500 });
      const itens = await db.select().from(osItens).where(eq(osItens.osId, os.id));
      expect(itens.map((i) => [i.nomeServico, i.valorCentavos, i.porteId]).sort()).toEqual([
        ['Cera', 1500, s.medio.id],
        ['Lavagem', 5000, s.medio.id],
      ]);
      expect(await db.select({ tipo: osEventos.tipo, de: osEventos.de, para: osEventos.para, membroId: osEventos.membroId }).from(osEventos)).toEqual([
        { tipo: 'status', de: null, para: 'aguardando', membroId: f.a.membros.recepcao.memberId },
      ]);
    }));

  it('abre OS para veículo sem placa', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      const [moto] = await db.insert(veiculos).values({ tenantId: f.a.tenantId, placa: null, porteId: s.medio.id, modelo: 'CG 160' }).returning();
      await como(f, f.a.membros.recepcao.userId);
      const r = await abrirOsAction({ veiculoId: moto.id, servicoIds: [s.lavagem.id] });
      if (!r.ok) throw new Error(JSON.stringify(r));
      expect(r.data.veiculo).toMatchObject({ placa: null, modelo: 'CG 160' });
    }));

  it('ignora valor enviado pelo cliente (payload com valorCentavos é rejeitado pelo schema strict)', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await como(f, f.a.membros.dono.userId);
      for (const extra of [{ valorCentavos: 1 }, { totalCentavos: 1 }, { tenantId: f.b.tenantId }]) {
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id], ...extra })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      }
      expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [{ id: s.lavagem.id, valorCentavos: 1 }] })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await contagem(db)).toBe('0');
    }));

  it('numero é sequencial por tenant com 20 aberturas concorrentes', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      const sB = await semear(db, f.b.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      const abrir = () => abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id] });
      expect(await abrir()).toMatchObject({ ok: true, data: { numero: 1 } });
      // barreira: segura a linha do contador até as aberturas estarem todas esperando o lock (o pool do app tem 10 conexões)
      const travado = Promise.withResolvers<void>();
      const trava = db.transaction(async (tx) => {
        await tx.select().from(osContadores).where(eq(osContadores.tenantId, f.a.tenantId)).for('update');
        travado.resolve();
        for (let i = 0; ; i++) {
          const { rows } = await db.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
          if ((rows[0].n as number) >= 10) break;
          if (i > 200) throw new Error('aberturas não chegaram ao lock');
          await new Promise((r) => setTimeout(r, 25));
        }
      });
      await travado.promise;
      const rs = await Promise.all([Promise.all(Array.from({ length: 20 }, abrir)), trava]).then(([x]) => x);
      const numeros = rs.map((r) => (r.ok ? r.data.numero : 0)).sort((a, b) => a - b);
      expect(numeros).toEqual(Array.from({ length: 20 }, (_, i) => i + 2));
      expect(new Set(rs.map((r) => r.ok && 'tokenPublico' in r.data && r.data.tokenPublico)).size).toBe(20);
      // outro tenant tem a própria sequência
      await como(f, f.b.membros.recepcao.userId);
      expect(await abrirOsAction({ veiculoId: sB.veiculo.id, servicoIds: [sB.lavagem.id] })).toMatchObject({ ok: true, data: { numero: 1 } });
    }));

  it('serviço sem preço para o porte é recusado (também inativo e de outro tenant)', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      const sB = await semear(db, f.b.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      for (const outro of [s.polimento.id, s.inativo.id, sB.cera.id, crypto.randomUUID()]) {
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id, outro] })).toEqual({
          ok: false,
          code: 'VALIDACAO',
          message: 'Dados inválidos.',
          fieldErrors: { servicoIds: ['Serviço indisponível para o porte do veículo.'] },
        });
      }
      expect(await contagem(db)).toBe('0');
    }));

  it('preço alterado depois não muda a OS', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await como(f, f.a.membros.gerente.userId);
      const r = await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id] });
      expect(r).toMatchObject({ ok: true, data: { totalCentavos: 5000 } });
      await db.update(precos).set({ valorCentavos: 9999 }).where(eq(precos.servicoId, s.lavagem.id));
      await db.update(servicos).set({ nome: 'Lavagem nova' }).where(eq(servicos.id, s.lavagem.id));
      expect(await db.select({ nome: osItens.nomeServico, valor: osItens.valorCentavos }).from(osItens)).toEqual([{ nome: 'Lavagem', valor: 5000 }]);
      expect((await db.select().from(ordensServico))[0]).toMatchObject({ subtotalCentavos: 5000, totalCentavos: 5000 });
      expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id] })).toMatchObject({ ok: true, data: { numero: 2, totalCentavos: 9999 } });
    }));

  it('contador de numeração travado por outra transação: falha em português em ~5 s, sem pendurar', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await db.insert(osContadores).values({ tenantId: f.a.tenantId, ultimo: 1 });
      await como(f, f.a.membros.recepcao.userId);
      const travado = Promise.withResolvers<void>();
      const solta = Promise.withResolvers<void>();
      const trava = db.transaction(async (tx) => {
        await tx.execute(sql`select 1 from os_contadores where tenant_id = ${f.a.tenantId} for update`);
        travado.resolve();
        await solta.promise;
      });
      await travado.promise;
      try {
        const t0 = Date.now();
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id] })).toEqual({ ok: false, code: 'CONFLITO_OS', message: 'Muitas aberturas ao mesmo tempo. Tente novamente.' });
        expect(Date.now() - t0).toBeGreaterThanOrEqual(4500);
        expect(Date.now() - t0).toBeLessThan(9000);
      } finally {
        solta.resolve();
        await trava;
      }
      expect(await db.select().from(ordensServico)).toHaveLength(0);
    }), 20_000);

  it('lavador abre atribuída a si e inicioLavagemEm é nulo; resposta sem dinheiro', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await comoLavador(f);
      const r = await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id, s.cera.id] });
      if (!r.ok) throw new Error(JSON.stringify(r));
      const me = f.a.membros.lavador.memberId;
      expect(r.data).toMatchObject({ numero: 1, status: 'aguardando', inicioLavagemEm: null, responsavel: { id: me, nomeExibicao: 'lavador' }, cliente: { nome: 'Ana' } });
      expect(chaves(r.data).filter((k) => /centavos|comissao|valor|total|token|telefone/i.test(k))).toEqual([]);
      expect(JSON.stringify(r)).not.toMatch(/centavos|comissao|5000|6500|1500/i);
      const [os] = await db.select().from(ordensServico);
      expect(os).toMatchObject({ responsavelId: me, abertaPor: me, inicioLavagemEm: null, totalCentavos: 6500 });
      expect(os.atribuidoEm).toBeInstanceOf(Date);
    }));

  it('lavador com responsavelId alheio recebe erro', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await comoLavador(f);
      for (const responsavelId of [f.a.membros.gerente.memberId, f.a.membros.lavador.memberId]) {
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id], responsavelId })).toEqual({
          ok: false,
          code: 'VALIDACAO',
          message: 'Dados inválidos.',
          fieldErrors: { responsavelId: ['O lavador só abre OS para si.'] },
        });
      }
      expect(await contagem(db)).toBe('0');
    }));

  it('balcão abre sem responsável', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      for (const m of [f.a.membros.dono, f.a.membros.gerente, f.a.membros.recepcao]) {
        await como(f, m.userId);
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id] })).toMatchObject({ ok: true, data: { responsavel: null } });
      }
      expect((await db.select().from(ordensServico)).map((o) => [o.numero, o.responsavelId, o.atribuidoEm])).toEqual(
        expect.arrayContaining([[1, null, null], [2, null, null], [3, null, null]]),
      );
    }));

  it('balcão abre já direcionada a um lavador ativo; inativo, não lavador e de outro tenant são recusados', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      const [u] = await db.insert(user).values({ name: 'Inativo', email: `${crypto.randomUUID()}@teste.invalid` }).returning();
      const [inativo] = await db.insert(membros).values({ tenantId: f.a.tenantId, userId: u.id, perfil: 'lavador', nomeExibicao: 'Inativo', ativo: false }).returning();
      await como(f, f.a.membros.recepcao.userId);
      const lav = f.a.membros.lavador.memberId;
      const r = await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id], responsavelId: lav });
      expect(r).toMatchObject({ ok: true, data: { responsavel: { id: lav, nomeExibicao: 'lavador' }, inicioLavagemEm: null, status: 'aguardando' } });
      const [os] = await db.select().from(ordensServico);
      expect(os).toMatchObject({ responsavelId: lav, abertaPor: f.a.membros.recepcao.memberId });
      expect(os.atribuidoEm).toBeInstanceOf(Date);
      const antes = await contagem(db);
      for (const responsavelId of [inativo.id, f.a.membros.gerente.memberId, f.b.membros.lavador.memberId]) {
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id], responsavelId })).toMatchObject({
          ok: false,
          code: 'VALIDACAO',
          fieldErrors: { responsavelId: ['Escolha um lavador ativo.'] },
        });
      }
      expect(await contagem(db)).toBe(antes);
    }));

  it('OS só com adicional é recusada', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.cera.id] })).toEqual({
        ok: false,
        code: 'VALIDACAO',
        message: 'Dados inválidos.',
        fieldErrors: { servicoIds: ['Escolha ao menos um serviço principal.'] },
      });
      expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [] })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { servicoIds: expect.any(Array) } });
      expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id, s.lavagem.id] })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { servicoIds: expect.any(Array) } });
      expect(await contagem(db)).toBe('0');
    }));

  it('item copia a comissão do serviço e mudança posterior não altera a OS', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id, s.cera.id] })).toMatchObject({ ok: true });
      await db.update(servicos).set({ comissaoTipo: 'fixo', comissaoValor: 1 });
      const itens = await db.select({ nome: osItens.nomeServico, tipo: osItens.comissaoTipo, valor: osItens.comissaoValor }).from(osItens);
      expect(itens.sort((a, b) => a.nome.localeCompare(b.nome))).toEqual([
        { nome: 'Cera', tipo: 'fixo', valor: 500 },
        { nome: 'Lavagem', tipo: 'percentual', valor: 3000 },
      ]);
    }));

  it('veículo de outro tenant é recusado', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      const sB = await semear(db, f.b.tenantId);
      await como(f, f.a.membros.recepcao.userId);
      for (const veiculoId of [sB.veiculo.id, crypto.randomUUID()]) {
        expect(await abrirOsAction({ veiculoId, servicoIds: [s.lavagem.id] })).toEqual({
          ok: false,
          code: 'VALIDACAO',
          message: 'Dados inválidos.',
          fieldErrors: { veiculoId: ['Veículo não encontrado.'] },
        });
      }
      expect(await abrirOsAction({ veiculoId: 'nao-e-uuid', servicoIds: [s.lavagem.id] })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { veiculoId: expect.any(Array) } });
      expect(await contagem(db)).toBe('0');
    }));

  it('sem sessão é acesso negado', () =>
    run(async (db, f) => {
      const s = await semear(db, f.a.tenantId);
      req.headers = new Headers();
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        expect(await abrirOsAction({ veiculoId: s.veiculo.id, servicoIds: [s.lavagem.id] })).toEqual({ ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' });
      } finally {
        warn.mockRestore();
      }
    }));
});
