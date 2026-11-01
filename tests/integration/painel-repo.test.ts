import { afterAll, describe, expect, it } from 'vitest';
import { getDatabase } from '@/lib/db/client';
import type { Database } from '@/lib/db/types';
import { carregarPainel } from '@/modules/painel/painel.repo';
import { createAuthFixtures, type AuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarMembro, criarOs, semearVeiculo } from '../helpers/ordens';

const AGORA = new Date('2026-10-30T15:00:00Z'); // 12:00 em SP; o dia começa em 03:00Z
const min = (m: number) => new Date(AGORA.getTime() - m * 60_000);

const run = (fn: (c: { db: Database; f: AuthFixtures; ctx: Parameters<typeof carregarPainel>[0]; os: (i?: Partial<Parameters<typeof criarOs>[1]>) => ReturnType<typeof criarOs> }) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const os = (i = {}) => criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId, entradaEm: min(5), ...i });
    await fn({ db, f, ctx: { tenantId: f.a.tenantId, perfil: 'dono' } as Parameters<typeof carregarPainel>[0], os });
  });

const chaves = (v: unknown): string[] =>
  v && typeof v === 'object' && !(v instanceof Date) ? Object.entries(v).flatMap(([k, x]) => [k, ...chaves(x)]) : [];

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('carregarPainel', () => {
  it('conta por status; entregues de hoje ignoram cancelada e entrega de ontem', () =>
    run(async ({ db, ctx, os }) => {
      await os();
      await os({ status: 'em_lavagem', inicioLavagemEm: min(5) });
      await os({ status: 'pronto', prontoEm: min(1) });
      await os({ status: 'entregue', prontoEm: min(30), entregueEm: min(10) });
      await os({ status: 'entregue', prontoEm: min(2000), entregueEm: min(1990) });
      await os({ status: 'cancelada' });
      const p = await carregarPainel(ctx, AGORA, db);
      expect(p.contagem).toEqual({ aguardando: 1, emLavagem: 1, pronto: 1, entreguesHoje: 1 });
      expect(p.atualizadoEm).toEqual(AGORA);
    }));

  it('o dia vira à meia-noite de São Paulo', () =>
    run(async ({ db, ctx, os }) => {
      await os({ status: 'entregue', prontoEm: new Date('2026-10-30T02:50:00Z'), entregueEm: new Date('2026-10-30T02:50:00Z') });
      expect((await carregarPainel(ctx, AGORA, db)).contagem.entreguesHoje).toBe(0);
      await os({ status: 'entregue', prontoEm: new Date('2026-10-30T03:10:00Z'), entregueEm: new Date('2026-10-30T03:10:00Z') });
      expect((await carregarPainel(ctx, AGORA, db)).contagem.entreguesHoje).toBe(1);
    }));

  it('tempo médio usa só prontas hoje com início de lavagem', () =>
    run(async ({ db, ctx, os }) => {
      await os({ status: 'pronto', inicioLavagemEm: min(40), prontoEm: min(20) }); // 20
      await os({ status: 'entregue', inicioLavagemEm: min(70), prontoEm: min(30), entregueEm: min(10) }); // 40
      await os({ status: 'pronto', prontoEm: min(5) }); // sem início
      await os({ status: 'pronto', inicioLavagemEm: min(3000), prontoEm: min(2900) }); // ontem
      expect((await carregarPainel(ctx, AGORA, db)).tempoMedioLavagemMin).toBe(30);
    }));

  it('atrasadas: 59 e 60 min não, 61 sim; mais atrasadas primeiro', () =>
    run(async ({ db, f, ctx, os }) => {
      const l = f.a.membros.lavador.memberId;
      await os({ entradaEm: min(59) });
      await os({ entradaEm: min(60) });
      const a = await os({ entradaEm: min(61) });
      const b = await os({ status: 'em_lavagem', responsavelId: l, entradaEm: min(300), inicioLavagemEm: min(90) });
      await os({ status: 'pronto', entradaEm: min(500), prontoEm: min(1) });
      const { atrasadas } = await carregarPainel(ctx, AGORA, db);
      expect(atrasadas).toEqual([
        { id: b.id, numero: b.numero, placa: 'ABC1D23', modelo: null, status: 'em_lavagem', minutos: 90 },
        { id: a.id, numero: a.numero, placa: 'ABC1D23', modelo: null, status: 'aguardando', minutos: 61 },
      ]);
    }));

  it('lavadores: livres primeiro; ocupado aparece uma vez com suas OSs; desativado some', () =>
    run(async ({ db, f, ctx, os }) => {
      const l = f.a.membros.lavador.memberId;
      const zeca = await criarMembro(db, f.a.tenantId, 'Zeca');
      await criarMembro(db, f.a.tenantId, 'Inativo', { ativo: false });
      const o1 = await os({ status: 'em_lavagem', responsavelId: l, inicioLavagemEm: min(5) });
      const o2 = await os({ status: 'em_lavagem', responsavelId: l, inicioLavagemEm: min(4) });
      const { lavadores } = await carregarPainel(ctx, AGORA, db);
      expect(lavadores.map((x) => x.membroId)).toEqual([zeca.id, l]);
      expect(lavadores[0]).toMatchObject({ livre: true, osEmLavagem: [] });
      expect(lavadores[1]).toMatchObject({ livre: false, osEmLavagem: [o1.numero, o2.numero] });
    }));

  it('tenant vazio: zeros, null e listas vazias', () =>
    run(async ({ db, f, ctx }) => {
      expect(await carregarPainel({ ...ctx, tenantId: f.b.tenantId }, AGORA, db)).toEqual({
        atualizadoEm: AGORA,
        contagem: { aguardando: 0, emLavagem: 0, pronto: 0, entreguesHoje: 0 },
        tempoMedioLavagemMin: null,
        atrasadas: [],
        lavadores: [expect.objectContaining({ livre: true })],
      });
    }));

  it('não vaza OS de outro tenant nem campos sensíveis', () =>
    run(async ({ db, f, ctx, os }) => {
      await os({ entradaEm: min(200) });
      const vb = await semearVeiculo(db, f.b.tenantId);
      await criarOs(db, { tenantId: f.b.tenantId, veiculoId: vb.id, abertaPor: f.b.membros.recepcao.memberId, entradaEm: min(500) });
      const p = await carregarPainel(ctx, AGORA, db);
      expect(p.atrasadas).toHaveLength(1);
      expect(p.contagem.aguardando).toBe(1);
      expect(chaves(p).filter((k) => /token|telefone|valor|total|centavos/i.test(k))).toEqual([]);
    }));
});
