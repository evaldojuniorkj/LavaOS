import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { membros, ordensServico, osContadores, osEventos, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { deactivateMemberAction } from '@/modules/equipe/equipe.actions';
import { abrirOsAction, atribuirResponsavelAction, transitarOsAction } from '@/modules/ordens/ordens.actions';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarOs, esperarNoLock, semearVeiculo, sessaoLavador, sessaoStaff } from '../helpers/ordens';

const req = vi.hoisted(() => ({ headers: new Headers() }));
vi.mock('next/headers', () => ({ headers: async () => req.headers }));

const run = (fn: (db: Database, f: AuthFixtures, osId: string) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const os = await criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId });
    await fn(db, f, os.id);
  });

/**
 * Barreira: segura a linha da OS, dispara as chamadas e só solta quando todas esperam o lock.
 * Cada action lê os headers no primeiro passo síncrono, então trocar `req.headers` entre as chamadas é seguro.
 */
async function simultaneas<T>(db: Database, chamadas: [Headers, () => Promise<T>][]): Promise<T[]> {
  const travado = Promise.withResolvers<void>();
  const trava = db.transaction(async (tx) => {
    await tx.select().from(ordensServico).for('update');
    travado.resolve();
    await esperarNoLock(db, chamadas.length);
  });
  await travado.promise;
  const disparadas = Promise.all(chamadas.map(([h, fn]) => ((req.headers = h), fn())));
  await trava;
  return disparadas;
}

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('concorrência de transições', () => {
  it('duas chamadas simultâneas de Pegar: exatamente uma vence e a outra recebe ConflitoOsError', () =>
    run(async (db, f, osId) => {
      const pegar = () => transitarOsAction({ osId, esperado: 'aguardando', para: 'em_lavagem' });
      const rs = await simultaneas(db, [
        [await sessaoLavador(f), pegar],
        [await sessaoStaff(f, f.a.membros.dono.userId), pegar],
      ]);
      const vencedor = rs.findIndex((r) => r.ok);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      const nome = vencedor === 0 ? 'lavador' : 'dono';
      expect(rs[1 - vencedor]).toEqual({ ok: false, code: 'CONFLITO_OS', message: `Essa OS já foi pega por ${nome}` });
      const [os] = await db.select().from(ordensServico).where(eq(ordensServico.id, osId));
      expect(os.responsavelId).toBe(vencedor === 0 ? f.a.membros.lavador.memberId : f.a.membros.dono.memberId);
      expect((await db.select().from(osEventos)).length).toBe(2); // status + responsável, só do vencedor
    }));

  it('Pegar concorrendo com Cancelar respeita o estado atual', () =>
    run(async (db, f, osId) => {
      const rs = await simultaneas(db, [
        [await sessaoLavador(f), () => transitarOsAction({ osId, esperado: 'aguardando', para: 'em_lavagem' })],
        [await sessaoStaff(f, f.a.membros.recepcao.userId), () => transitarOsAction({ osId, esperado: 'aguardando', para: 'cancelada', motivo: 'desistiu' })],
      ]);
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
      const [os] = await db.select().from(ordensServico).where(eq(ordensServico.id, osId));
      const eventos = await db.select({ tipo: osEventos.tipo, para: osEventos.para }).from(osEventos);
      if (rs[0].ok) {
        expect(rs[1]).toEqual({ ok: false, code: 'CONFLITO_OS', message: 'Essa OS já foi pega por lavador' });
        expect(os).toMatchObject({ status: 'em_lavagem', responsavelId: f.a.membros.lavador.memberId, canceladaEm: null });
        expect(eventos).toHaveLength(2);
      } else {
        expect(rs[0]).toEqual({ ok: false, code: 'CONFLITO_OS', message: 'Essa OS mudou de status' });
        expect(os).toMatchObject({ status: 'cancelada', responsavelId: null, inicioLavagemEm: null, motivoCancelamento: 'desistiu' });
        expect(eventos).toEqual([{ tipo: 'status', para: 'cancelada' }]);
      }
    }));
});

/**
 * Barreira: FOR SHARE na linha do lavador L. A desativação (pelo gerente G) trava o tenant e G e fica presa em L;
 * só então a ação de OS (do mesmo G) pega FOR SHARE em L e grava linhas com FK para G (KEY SHARE).
 * Com FOR UPDATE em G a ação esperaria a desativação, que espera a ação: deadlock (40P01 → ERRO_INTERNO).
 */
async function desativarDurante<T>(db: Database, f: AuthFixtures, acao: () => Promise<T>) {
  const lavador = f.a.membros.lavador.memberId;
  req.headers = await sessaoStaff(f, f.a.membros.gerente.userId);
  const travado = Promise.withResolvers<void>();
  const soltar = Promise.withResolvers<void>();
  const barreira = db.transaction(async (tx) => {
    await tx.select({ id: membros.id }).from(membros).where(eq(membros.id, lavador)).for('share');
    travado.resolve();
    await soltar.promise;
  });
  await travado.promise;
  const desativar = deactivateMemberAction({ memberId: lavador });
  await esperarNoLock(db, 1);
  let fim = false;
  const feita = acao().finally(() => (fim = true));
  // corrigido: a ação não espera ninguém e termina; com a trava antiga ela fica presa atrás da desativação (2 em espera)
  for (let i = 0; !fim && i < 200; i++) {
    const { rows } = await db.execute(sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`);
    if ((rows[0].n as number) >= 2) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  soltar.resolve();
  await barreira;
  return Promise.all([feita, desativar]);
}

describe('equipe × ordens: desativar o lavador enquanto o mesmo gerente mexe numa OS dele', () => {
  const inativo = async (db: Database, f: AuthFixtures) => (await db.select({ ativo: membros.ativo }).from(membros).where(eq(membros.id, f.a.membros.lavador.memberId)))[0].ativo === false;

  it('direcionar a OS para o lavador: sem deadlock, as duas concluem', () =>
    run(async (db, f, osId) => {
      const [r, d] = await desativarDurante(db, f, () => atribuirResponsavelAction({ osId, membroId: f.a.membros.lavador.memberId }));
      expect(r).toMatchObject({ ok: true });
      expect(d).toEqual({ ok: true, data: null });
      const [os] = await db.select().from(ordensServico).where(eq(ordensServico.id, osId));
      expect(os.responsavelId).toBe(f.a.membros.lavador.memberId); // gravada antes da desativação
      expect(await inativo(db, f)).toBe(true);
    }));

  it('abrir OS para o lavador: sem deadlock, as duas concluem', () =>
    run(async (db, f) => {
      const [veiculo] = await db.select().from(ordensServico);
      const [servico] = await db.select({ id: servicos.id }).from(servicos);
      await db.insert(osContadores).values({ tenantId: f.a.tenantId, ultimo: 1 }); // a OS da fixture (criarOs) já usou o número 1
      const [r, d] = await desativarDurante(db, f, () => abrirOsAction({ veiculoId: veiculo.veiculoId, servicoIds: [servico.id], responsavelId: f.a.membros.lavador.memberId }));
      expect(r).toMatchObject({ ok: true });
      expect(d).toEqual({ ok: true, data: null });
      expect((await db.select().from(ordensServico).where(eq(ordensServico.responsavelId, f.a.membros.lavador.memberId))).length).toBe(1);
      expect(await inativo(db, f)).toBe(true);
    }));
});
