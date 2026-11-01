import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { caixas, ordensServico, pagamentos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { abrirCaixa, fecharCaixa, receber } from '@/modules/caixa/caixa.service';
import { createAuthFixtures } from '../helpers/auth';
import { withTestDatabase } from '../helpers/db';
import { criarOs, esperarNoLock, semearVeiculo } from '../helpers/ordens';

const run = (fn: (db: Database, rec: TenantContext, osId: string, caixaId: string) => Promise<void>) =>
  withTestDatabase(async (db) => {
    const f = await createAuthFixtures(db);
    const v = await semearVeiculo(db, f.a.tenantId);
    const os = await criarOs(db, { tenantId: f.a.tenantId, veiculoId: v.id, abertaPor: f.a.membros.recepcao.memberId });
    const m = f.a.membros.recepcao;
    const rec = { tenantId: f.a.tenantId, userId: m.userId, memberId: m.memberId, perfil: 'recepcao', sessionId: 'x' } as TenantContext;
    const { caixa } = await abrirCaixa(rec, { trocoInicialCentavos: 10000 }, db);
    await fn(db, rec, os.id, caixa.id);
  });

/** Segura a linha (`tabela`) e só solta quando cada chamada, disparada em ordem, já espera o lock. */
async function simultaneas<T>(db: Database, tabela: typeof ordensServico | typeof caixas, chamadas: (() => Promise<T>)[]) {
  const travado = Promise.withResolvers<void>();
  const soltar = Promise.withResolvers<void>();
  const trava = db.transaction(async (tx) => {
    await tx.select({ id: tabela.id }).from(tabela).for('update');
    travado.resolve();
    await soltar.promise;
  });
  await travado.promise;
  const disparadas: Promise<PromiseSettledResult<T>>[] = [];
  for (const [i, fn] of chamadas.entries()) {
    disparadas.push(fn().then((value) => ({ status: 'fulfilled', value }) as const, (reason) => ({ status: 'rejected', reason }) as const));
    await esperarNoLock(db, i + 1); // fila do lock na ordem da lista
  }
  soltar.resolve();
  await trava;
  return Promise.all(disparadas);
}

afterAll(async () => {
  await (getDatabase() as unknown as { $client: { end(): Promise<void> } }).$client.end();
});

describe('concorrência do caixa', () => {
  it('dois recebimentos de 60% do total ao mesmo tempo: um passa, o outro é recusado', () =>
    run(async (db, rec, osId) => {
      const r60 = () => receber(rec, { osId, forma: 'pix', valorCentavos: 3000 }, db);
      const rs = await simultaneas(db, ordensServico, [r60, r60]);
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(rs.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'ACIMA_DO_SALDO' } });
      expect(await db.select().from(pagamentos)).toHaveLength(1);
    }));

  it.each([
    ['receber chega antes', 'receber'],
    ['fechar chega antes', 'fechar'],
  ])('fechar durante um recebimento (%s): o pagamento entra no esperado ou é recusado', (_nome, primeiro) =>
    run(async (db, rec, osId, caixaId) => {
      const rcb = () => receber(rec, { osId, forma: 'dinheiro', valorCentavos: 5000 }, db);
      const fch = () => fecharCaixa(rec, { caixaId, dinheiroContadoCentavos: 15000 }, db);
      const [a, b] = await simultaneas<unknown>(db, caixas, primeiro === 'receber' ? [rcb, fch] : [fch, rcb]);
      const [r, f] = primeiro === 'receber' ? [a, b] : [b, a];
      expect(f.status).toBe('fulfilled');
      const [c] = await db.select().from(caixas).where(eq(caixas.id, caixaId));
      const pagos = await db.select().from(pagamentos);
      if (r.status === 'fulfilled') {
        expect(pagos).toHaveLength(1);
        expect(c).toMatchObject({ status: 'fechado', diferencaCentavos: 0 }); // 10000 + 5000 contados
      } else {
        expect(r.reason).toMatchObject({ code: 'SEM_CAIXA' });
        expect(pagos).toHaveLength(0);
        expect(c).toMatchObject({ status: 'fechado', diferencaCentavos: 5000 });
      }
      // com a ordem forçada, o resultado é o da fila do lock
      expect(r.status).toBe(primeiro === 'receber' ? 'fulfilled' : 'rejected');
    }));
});
