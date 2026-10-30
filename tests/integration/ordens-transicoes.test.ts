import { asc, eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { membros, ordensServico, osEventos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import type { TenantContext } from '@/lib/auth/types';
import { atribuirResponsavelAction, listarLavadoresAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { transitarOs } from '@/modules/ordens/ordens.service';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarMembro, criarOs, semearVeiculo, sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

type Ctx = { db: Database; f: AuthFixtures; veiculoId: string; os: (i?: Omit<Parameters<typeof criarOs>[1], 'tenantId' | 'veiculoId' | 'abertaPor'>) => ReturnType<typeof criarOs> };
const run = (fn: (c: Ctx) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    await fn({ db, f, veiculoId: v.id, os: (i = {}) => criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId, ...i }) });
  });

const comoLavador = async (f: AuthFixtures) => void (req.headers = await sessaoLavador(f));
const como = async (f: AuthFixtures, userId: string) => void (req.headers = await sessaoStaff(f, userId));
const eventos = (db: Database, osId: string) =>
  db.select({ tipo: osEventos.tipo, de: osEventos.de, para: osEventos.para, membroId: osEventos.membroId, motivo: osEventos.motivo }).from(osEventos).where(eq(osEventos.osId, osId)).orderBy(asc(osEventos.tipo), asc(osEventos.em));
const linha = async (db: Database, id: string) => (await db.select().from(ordensServico).where(eq(ordensServico.id, id)))[0];
/** Silencia e devolve o log de acesso negado (output limpo e verificado). */
async function negado<T>(fn: () => Promise<T>) {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const r = await fn();
    expect(warn).toHaveBeenCalledWith('[auth] acesso negado', expect.any(Object));
    return r;
  } finally {
    warn.mockRestore();
  }
}
const ACESSO_NEGADO = { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('transitarOsAction', () => {
  it('Pegar sem responsável torna quem pegou o responsável e preenche inicioLavagemEm', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      await comoLavador(f);
      const me = f.a.membros.lavador.memberId;
      const r = await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' });
      if (!r.ok) throw new Error(JSON.stringify(r));
      expect(r.data).toMatchObject({ status: 'em_lavagem', responsavel: { id: me, nomeExibicao: 'lavador' }, inicioLavagemEm: expect.any(Date), atribuidoEm: expect.any(Date) });
      expect(JSON.stringify(r)).not.toMatch(/centavos|5000|token|telefone/i);
      expect(await linha(db, o.id)).toMatchObject({ status: 'em_lavagem', responsavelId: me, abertaPor: f.a.membros.recepcao.memberId });
      expect(await eventos(db, o.id)).toEqual([
        { tipo: 'responsavel', de: null, para: me, membroId: me, motivo: null },
        { tipo: 'status', de: 'aguardando', para: 'em_lavagem', membroId: me, motivo: null },
      ]);
    }));

  it('Pegar em OS com outro responsável é recusado', () =>
    run(async ({ db, f, os }) => {
      const o = await os({ responsavelId: f.a.membros.lavador.memberId });
      await como(f, f.a.membros.gerente.userId);
      expect(await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' })).toEqual({ ok: false, code: 'NAO_E_RESPONSAVEL', message: 'Essa OS é de outro responsável.' });
      // já em lavagem por outro: conflito nomeando quem pegou
      const e = await os({ status: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId });
      expect(await transitarOsAction({ osId: e.id, esperado: 'aguardando', para: 'em_lavagem' })).toEqual({ ok: false, code: 'CONFLITO_OS', message: 'Essa OS já foi pega por lavador' });
      expect(await linha(db, o.id)).toMatchObject({ status: 'aguardando', responsavelId: f.a.membros.lavador.memberId });
      expect(await eventos(db, o.id)).toEqual([]);
    }));

  it('lavador não inicia OS aguardando atribuída a outro', () =>
    run(async ({ db, f, os }) => {
      const outro = await criarMembro(db, f.a.tenantId, 'Bruno');
      const o = await os({ responsavelId: outro.id });
      await comoLavador(f);
      expect(await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' })).toMatchObject({ ok: false, code: 'NAO_E_RESPONSAVEL' });
      // nem indicando a si mesmo como responsável: o lavador não direciona
      expect(await negado(() => transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId }))).toEqual(ACESSO_NEGADO);
      // nem marca pronto a OS de outro
      const e = await os({ status: 'em_lavagem', responsavelId: outro.id });
      expect(await transitarOsAction({ osId: e.id, esperado: 'em_lavagem', para: 'pronto' })).toMatchObject({ ok: false, code: 'NAO_E_RESPONSAVEL' });
      expect((await db.select().from(osEventos)).length).toBe(0);
    }));

  it('balcão inicia escolhendo o responsável e o evento registra autor ≠ responsável', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      await como(f, f.a.membros.recepcao.userId);
      const lav = f.a.membros.lavador.memberId;
      const rec = f.a.membros.recepcao.memberId;
      const r = await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem', responsavelId: lav });
      expect(r).toMatchObject({ ok: true, data: { status: 'em_lavagem', responsavel: { id: lav }, totalCentavos: 5000 } });
      expect(await eventos(db, o.id)).toEqual([
        { tipo: 'responsavel', de: null, para: lav, membroId: rec, motivo: null },
        { tipo: 'status', de: 'aguardando', para: 'em_lavagem', membroId: rec, motivo: null },
      ]);
      expect(await linha(db, o.id)).toMatchObject({ responsavelId: lav, abertaPor: rec });
      // recepção sem indicar responsável seria "Pegar" (os:assumir), que ela não tem
      const o2 = await os();
      expect(await negado(() => transitarOsAction({ osId: o2.id, esperado: 'aguardando', para: 'em_lavagem' }))).toEqual(ACESSO_NEGADO);
      // responsável indicado precisa ser lavador ativo do tenant
      for (const responsavelId of [f.a.membros.gerente.memberId, f.b.membros.lavador.memberId, crypto.randomUUID()]) {
        expect(await transitarOsAction({ osId: o2.id, esperado: 'aguardando', para: 'em_lavagem', responsavelId })).toMatchObject({
          ok: false,
          code: 'VALIDACAO',
          fieldErrors: { responsavelId: ['Escolha um lavador ativo.'] },
        });
      }
      expect(await linha(db, o2.id)).toMatchObject({ status: 'aguardando', responsavelId: null });
    }));

  it('Pegar repetido pelo mesmo responsável não duplica evento', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      await comoLavador(f);
      const pegar = () => transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' });
      expect(await pegar()).toMatchObject({ ok: true });
      const antes = await linha(db, o.id);
      expect(await pegar()).toMatchObject({ ok: true, data: { status: 'em_lavagem', responsavel: { id: f.a.membros.lavador.memberId } } });
      expect((await eventos(db, o.id)).length).toBe(2);
      expect((await linha(db, o.id)).updatedAt).toEqual(antes.updatedAt);
      // OS direcionada a mim: Pegar inicia sem novo evento de responsável
      const d = await os({ responsavelId: f.a.membros.lavador.memberId });
      expect(await transitarOsAction({ osId: d.id, esperado: 'aguardando', para: 'em_lavagem' })).toMatchObject({ ok: true });
      expect((await eventos(db, d.id)).map((e) => e.tipo)).toEqual(['status']);
    }));

  it('Pronto exige responsável', () =>
    run(async ({ db, f, os }) => {
      const o = await os({ status: 'em_lavagem' });
      await como(f, f.a.membros.gerente.userId);
      expect(await transitarOsAction({ osId: o.id, esperado: 'em_lavagem', para: 'pronto' })).toEqual({ ok: false, code: 'SEM_RESPONSAVEL', message: 'Defina o responsável antes.' });
      const p = await os({ status: 'pronto' });
      expect(await transitarOsAction({ osId: p.id, esperado: 'pronto', para: 'entregue' })).toMatchObject({ ok: false, code: 'SEM_RESPONSAVEL' });
      // com responsável: pronto e entregue preenchem os horários
      const e = await os({ status: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId });
      expect(await transitarOsAction({ osId: e.id, esperado: 'em_lavagem', para: 'pronto' })).toMatchObject({ ok: true, data: { status: 'pronto', prontoEm: expect.any(Date) } });
      expect(await transitarOsAction({ osId: e.id, esperado: 'pronto', para: 'entregue' })).toMatchObject({ ok: true, data: { status: 'entregue', entregueEm: expect.any(Date) } });
      expect((await eventos(db, e.id)).map((x) => [x.de, x.para, x.membroId])).toEqual([
        ['em_lavagem', 'pronto', f.a.membros.gerente.memberId],
        ['pronto', 'entregue', f.a.membros.gerente.memberId],
      ]);
    }));

  it('voltar a aguardando zera inicioLavagemEm e o novo início grava um instante posterior', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      await comoLavador(f);
      await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' });
      const primeiro = (await linha(db, o.id)).inicioLavagemEm;
      expect(primeiro).toBeInstanceOf(Date);
      await como(f, f.a.membros.recepcao.userId);
      await transitarOsAction({ osId: o.id, esperado: 'em_lavagem', para: 'aguardando' });
      expect((await linha(db, o.id)).inicioLavagemEm).toBeNull();
      await new Promise((r) => setTimeout(r, 20));
      await comoLavador(f);
      await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' });
      expect((await linha(db, o.id)).inicioLavagemEm!.getTime()).toBeGreaterThan(primeiro!.getTime());
    }));

  it('lavador desativado não consegue Pegar e a OS segue sem responsável', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      const { memberId, userId } = f.a.membros.lavador;
      await db.update(membros).set({ ativo: false }).where(eq(membros.id, memberId));
      // o contexto já havia sido emitido quando a desativação aconteceu
      const ctx = { tenantId: f.a.tenantId, userId, memberId, perfil: 'lavador', sessionId: 'x' } as TenantContext;
      await expect(transitarOs(ctx, { osId: o.id, esperado: 'aguardando', para: 'em_lavagem' }, db)).rejects.toMatchObject({ code: 'VALIDACAO', fieldErrors: { responsavelId: ['Escolha um lavador ativo.'] } });
      expect(await linha(db, o.id)).toMatchObject({ status: 'aguardando', responsavelId: null });
      expect(await eventos(db, o.id)).toEqual([]);
    }));

  it('corrigir em_lavagem→aguardando remove o responsável', () =>
    run(async ({ db, f, os }) => {
      const lav = f.a.membros.lavador.memberId;
      const o = await os({ status: 'em_lavagem', responsavelId: lav });
      await comoLavador(f);
      expect(await negado(() => transitarOsAction({ osId: o.id, esperado: 'em_lavagem', para: 'aguardando' }))).toEqual(ACESSO_NEGADO);
      await como(f, f.a.membros.recepcao.userId);
      expect(await transitarOsAction({ osId: o.id, esperado: 'em_lavagem', para: 'aguardando' })).toMatchObject({ ok: true, data: { status: 'aguardando', responsavel: null, atribuidoEm: null } });
      expect(await linha(db, o.id)).toMatchObject({ status: 'aguardando', responsavelId: null, atribuidoEm: null });
      const rec = f.a.membros.recepcao.memberId;
      expect(await eventos(db, o.id)).toEqual([
        { tipo: 'responsavel', de: lav, para: null, membroId: rec, motivo: null },
        { tipo: 'status', de: 'em_lavagem', para: 'aguardando', membroId: rec, motivo: null },
      ]);
      // pronto→em_lavagem com motivo registrado
      const p = await os({ status: 'pronto', responsavelId: lav });
      expect(await transitarOsAction({ osId: p.id, esperado: 'pronto', para: 'em_lavagem', motivo: ' faltou o vidro ' })).toMatchObject({ ok: true, data: { status: 'em_lavagem' } });
      expect(await eventos(db, p.id)).toEqual([{ tipo: 'status', de: 'pronto', para: 'em_lavagem', membroId: rec, motivo: 'faltou o vidro' }]);
    }));

  it('OS cancelada rejeita qualquer alteração', () =>
    run(async ({ db, f, os }) => {
      await como(f, f.a.membros.gerente.userId);
      const o = await os();
      expect(await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'cancelada' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { motivo: ['Informe o motivo.'] } });
      expect(await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'cancelada', motivo: 'desistiu' })).toMatchObject({ ok: true, data: { status: 'cancelada', canceladaEm: expect.any(Date) } });
      expect(await linha(db, o.id)).toMatchObject({ motivoCancelamento: 'desistiu' });
      for (const para of ['aguardando', 'em_lavagem', 'pronto', 'entregue'] as const) {
        expect(await transitarOsAction({ osId: o.id, esperado: 'cancelada', para })).toEqual({ ok: false, code: 'OS_ENCERRADA', message: 'OS cancelada não pode ser alterada.' });
      }
      expect(await transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId })).toEqual({
        ok: false,
        code: 'CONFLITO_OS',
        message: 'Essa OS mudou de status',
      });
      expect(await atribuirResponsavelAction({ osId: o.id, membroId: f.a.membros.lavador.memberId })).toEqual({ ok: false, code: 'OS_ENCERRADA', message: 'OS cancelada não pode ser alterada.' });
      expect((await eventos(db, o.id)).length).toBe(1);
    }));

  it('entregue não reabre', () =>
    run(async ({ db, f, os }) => {
      const o = await os({ status: 'entregue', responsavelId: f.a.membros.lavador.memberId });
      await como(f, f.a.membros.dono.userId);
      for (const para of ['pronto', 'em_lavagem', 'cancelada'] as const) {
        expect(await transitarOsAction({ osId: o.id, esperado: 'entregue', para, motivo: 'x' })).toEqual({ ok: false, code: 'OS_ENCERRADA', message: 'OS entregue não pode ser alterada.' });
      }
      expect(await atribuirResponsavelAction({ osId: o.id, membroId: null })).toMatchObject({ ok: false, code: 'OS_ENCERRADA' });
      expect(await linha(db, o.id)).toMatchObject({ status: 'entregue', responsavelId: f.a.membros.lavador.memberId });
    }));

  it('recepcao recebe acesso negado em os:assumir', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      await como(f, f.a.membros.recepcao.userId);
      expect(await negado(() => transitarOsAction({ osId: o.id, esperado: 'aguardando', para: 'em_lavagem' }))).toEqual(ACESSO_NEGADO);
      expect(await linha(db, o.id)).toMatchObject({ status: 'aguardando', responsavelId: null });
    }));

  it('OS de outro tenant, id malformado e campos extras são recusados', () =>
    run(async ({ db, f }) => {
      const vB = await semearVeiculo(db, f.b.tenantId);
      const oB = await criarOs(db, { tenantId: f.b.tenantId, veiculoId: vB.id, abertaPor: f.b.membros.recepcao.memberId });
      await como(f, f.a.membros.dono.userId);
      expect(await transitarOsAction({ osId: oB.id, esperado: 'aguardando', para: 'em_lavagem' })).toEqual({ ok: false, code: 'NAO_ENCONTRADO', message: 'OS não encontrada.' });
      expect(await atribuirResponsavelAction({ osId: oB.id, membroId: null })).toEqual({ ok: false, code: 'NAO_ENCONTRADO', message: 'OS não encontrada.' });
      expect(await transitarOsAction({ osId: 'x', esperado: 'aguardando', para: 'em_lavagem' })).toMatchObject({ ok: false, code: 'VALIDACAO', fieldErrors: { osId: expect.any(Array) } });
      expect(await transitarOsAction({ osId: oB.id, esperado: 'aguardando', para: 'em_lavagem', totalCentavos: 1 })).toMatchObject({ ok: false, code: 'VALIDACAO' });
      expect(await linha(db, oB.id)).toMatchObject({ status: 'aguardando', responsavelId: null });
    }));
});

describe('atribuirResponsavelAction', () => {
  it('atribuir a membro que não é lavador ou inativo é recusado', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      const inativo = await criarMembro(db, f.a.tenantId, 'Inativo', { ativo: false });
      await como(f, f.a.membros.recepcao.userId);
      for (const membroId of [inativo.id, f.a.membros.gerente.memberId, f.b.membros.lavador.memberId, crypto.randomUUID()]) {
        expect(await atribuirResponsavelAction({ osId: o.id, membroId })).toEqual({ ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: { membroId: ['Escolha um lavador ativo.'] } });
      }
      expect(await eventos(db, o.id)).toEqual([]);
    }));

  it('atribuir a lavador ocupado é permitido; trocar e remover registram histórico', () =>
    run(async ({ db, f, os }) => {
      const lav = f.a.membros.lavador.memberId;
      await os({ status: 'em_lavagem', responsavelId: lav });
      const o = await os({ status: 'em_lavagem' });
      const bruno = await criarMembro(db, f.a.tenantId, 'Bruno');
      await como(f, f.a.membros.gerente.userId);
      const ger = f.a.membros.gerente.memberId;
      expect(await atribuirResponsavelAction({ osId: o.id, membroId: lav })).toMatchObject({ ok: true, data: { status: 'em_lavagem', responsavel: { id: lav } } });
      expect(await atribuirResponsavelAction({ osId: o.id, membroId: lav })).toMatchObject({ ok: true }); // repetido: sem evento
      expect(await atribuirResponsavelAction({ osId: o.id, membroId: bruno.id })).toMatchObject({ ok: true, data: { responsavel: { id: bruno.id, nomeExibicao: 'Bruno' } } });
      expect(await atribuirResponsavelAction({ osId: o.id, membroId: null })).toMatchObject({ ok: true, data: { responsavel: null, atribuidoEm: null } });
      const evs = await db.select({ de: osEventos.de, para: osEventos.para, membroId: osEventos.membroId, tipo: osEventos.tipo }).from(osEventos).where(eq(osEventos.osId, o.id)).orderBy(asc(osEventos.em));
      expect(evs).toEqual([
        { tipo: 'responsavel', de: null, para: lav, membroId: ger },
        { tipo: 'responsavel', de: lav, para: bruno.id, membroId: ger },
        { tipo: 'responsavel', de: bruno.id, para: null, membroId: ger },
      ]);
      expect(await linha(db, o.id)).toMatchObject({ status: 'em_lavagem', responsavelId: null, atribuidoEm: null });
    }));

  it('lavador recebe acesso negado em atribuirResponsavelAction', () =>
    run(async ({ db, f, os }) => {
      const o = await os();
      await comoLavador(f);
      expect(await negado(() => atribuirResponsavelAction({ osId: o.id, membroId: f.a.membros.lavador.memberId }))).toEqual(ACESSO_NEGADO);
      expect(await negado(() => listarLavadoresAction())).toEqual(ACESSO_NEGADO);
      expect(await linha(db, o.id)).toMatchObject({ responsavelId: null });
    }));
});

describe('listarLavadoresAction', () => {
  it('listarLavadoresParaDirecionar marca livre/ocupado e exatamente um sugerido (ou nenhum)', () =>
    run(async ({ db, f, os }) => {
      const lav = f.a.membros.lavador.memberId;
      const antigo = await criarMembro(db, f.a.tenantId, 'Antigo', { createdAt: new Date('2020-01-01') });
      const recente = await criarMembro(db, f.a.tenantId, 'Recente', { createdAt: new Date('2020-01-02') });
      await criarMembro(db, f.a.tenantId, 'Inativo', { ativo: false });
      await criarMembro(db, f.b.tenantId, 'De B');
      // Antigo terminou uma OS agora há pouco; Recente nunca terminou: Recente é o livre há mais tempo
      await os({ status: 'pronto', responsavelId: antigo.id, prontoEm: new Date() });
      await os({ status: 'em_lavagem', responsavelId: lav });
      await como(f, f.a.membros.recepcao.userId);
      const r = await listarLavadoresAction();
      if (!r.ok) throw new Error(JSON.stringify(r));
      expect([...r.data].sort((a, b) => a.nome.localeCompare(b.nome))).toEqual([
        { membroId: antigo.id, nome: 'Antigo', livre: true, sugerido: false },
        { membroId: lav, nome: 'lavador', livre: false, sugerido: false },
        { membroId: recente.id, nome: 'Recente', livre: true, sugerido: true },
      ]);
      // todos ocupados: nenhum sugerido
      await os({ status: 'em_lavagem', responsavelId: antigo.id });
      await os({ status: 'em_lavagem', responsavelId: recente.id });
      const r2 = await listarLavadoresAction();
      expect(r2.ok && r2.data.map((l) => [l.livre, l.sugerido])).toEqual([[false, false], [false, false], [false, false]]);
    }));
});
