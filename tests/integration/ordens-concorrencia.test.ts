import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, osEventos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { transitarOsAction } from '@/modules/ordens/ordens.actions';
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
