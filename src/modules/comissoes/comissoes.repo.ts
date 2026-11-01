import 'server-only';
import { and, asc, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { acertosComissao, comissoes, membros, ordensServico, osItens, vales } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { calcularAcerto } from './comissoes.rules';

type Leitor = Pick<Database, 'select' | 'selectDistinctOn'>;
const diaSp = (col: typeof ordensServico.entregueEm | typeof vales.dadoEm) => sql`(${col} at time zone 'America/Sao_Paulo')::date`;

/** Pendente = sem acerto; comissão só de OS entregue até o fim do dia `ate` em São Paulo, vale não cancelado dado até `ate`. */
export const comissoesPendentes = (ctx: TenantContext, ate: string) =>
  and(
    eq(comissoes.tenantId, ctx.tenantId),
    isNull(comissoes.acertoId),
    // sem trava na OS: o acerto não pode cruzar com a reabertura, que trava OS → comissões
    sql`${comissoes.osId} in (select ${ordensServico.id} from ${ordensServico} where ${ordensServico.tenantId} = ${ctx.tenantId} and ${ordensServico.status} = 'entregue' and ${diaSp(ordensServico.entregueEm)} <= ${ate})`,
  );
export const valesPendentes = (ctx: TenantContext, ate: string) =>
  and(eq(vales.tenantId, ctx.tenantId), isNull(vales.acertoId), isNull(vales.canceladoEm), sql`${diaSp(vales.dadoEm)} <= ${ate}`);

/** Saldo devedor do último acerto de cada membro (só os que ficaram devendo). */
function saldosDevedores(ctx: TenantContext, db: Leitor) {
  return db
    .selectDistinctOn([acertosComissao.membroId], { membroId: acertosComissao.membroId, saldo: acertosComissao.saldoDevedorCentavos })
    .from(acertosComissao)
    .where(eq(acertosComissao.tenantId, ctx.tenantId))
    .orderBy(acertosComissao.membroId, desc(acertosComissao.pagoEm), desc(acertosComissao.createdAt));
}

export async function saldoAnterior(ctx: TenantContext, membroId: string, db: Leitor = getDatabase()) {
  const [ultimo] = await db
    .select({ saldo: acertosComissao.saldoDevedorCentavos })
    .from(acertosComissao)
    .where(and(eq(acertosComissao.tenantId, ctx.tenantId), eq(acertosComissao.membroId, membroId)))
    .orderBy(desc(acertosComissao.pagoEm), desc(acertosComissao.createdAt))
    .limit(1);
  return ultimo?.saldo ?? 0;
}

/** Todos os membros com comissão, vale ou saldo devedor, inclusive desativados, com a conta do acerto até `ate`. */
export async function pendentesPorMembro(ctx: TenantContext, ate: string, db: Leitor = getDatabase()) {
  const [com, val, saldos, lista] = await Promise.all([
    db.select({ membroId: comissoes.membroId, total: sql<number>`sum(${comissoes.valorCentavos})::int` }).from(comissoes).where(comissoesPendentes(ctx, ate)).groupBy(comissoes.membroId),
    db.select({ membroId: vales.membroId, total: sql<number>`sum(${vales.valorCentavos})::int` }).from(vales).where(valesPendentes(ctx, ate)).groupBy(vales.membroId),
    saldosDevedores(ctx, db),
    db.select({ membroId: membros.id, nome: membros.nomeExibicao, ativo: membros.ativo }).from(membros).where(eq(membros.tenantId, ctx.tenantId)).orderBy(asc(membros.nomeExibicao)),
  ]);
  const total = (l: { membroId: string; total: number }[]) => new Map(l.map((x) => [x.membroId, x.total]));
  const [c, v, sa] = [total(com), total(val), new Map(saldos.map((x) => [x.membroId, x.saldo]))];
  return lista
    .map((m) => ({ ...m, ...calcularAcerto({ comissoes: [c.get(m.membroId) ?? 0], vales: [v.get(m.membroId) ?? 0], saldoAnterior: sa.get(m.membroId) ?? 0 }) }))
    .filter((m) => m.comissoesCentavos || m.valesCentavos || m.saldoAnteriorCentavos);
}

export function acertosDoMembro(ctx: TenantContext, membroId: string, db: Leitor = getDatabase()) {
  return db
    .select()
    .from(acertosComissao)
    .where(and(eq(acertosComissao.tenantId, ctx.tenantId), eq(acertosComissao.membroId, membroId)))
    .orderBy(desc(acertosComissao.pagoEm), desc(acertosComissao.createdAt));
}

/** Para a impressão: cada OS e item com a comissão, e os vales descontados. */
export async function detalheAcerto(ctx: TenantContext, acertoId: string, db: Leitor = getDatabase()) {
  const [acerto] = await db
    .select({ ...getTableColumns(acertosComissao), membroNome: membros.nomeExibicao })
    .from(acertosComissao)
    .innerJoin(membros, and(eq(membros.tenantId, acertosComissao.tenantId), eq(membros.id, acertosComissao.membroId)))
    .where(and(eq(acertosComissao.tenantId, ctx.tenantId), eq(acertosComissao.id, acertoId)));
  if (!acerto) return null;
  const [itens, descontados] = await Promise.all([
    db
      .select({
        osId: ordensServico.id,
        osNumero: ordensServico.numero,
        entregueEm: ordensServico.entregueEm,
        nomeServico: osItens.nomeServico,
        itemCentavos: osItens.valorCentavos,
        baseCentavos: comissoes.baseCentavos,
        valorCentavos: comissoes.valorCentavos,
      })
      .from(comissoes)
      .innerJoin(osItens, and(eq(osItens.tenantId, comissoes.tenantId), eq(osItens.id, comissoes.osItemId)))
      .innerJoin(ordensServico, and(eq(ordensServico.tenantId, comissoes.tenantId), eq(ordensServico.id, comissoes.osId)))
      .where(and(eq(comissoes.tenantId, ctx.tenantId), eq(comissoes.acertoId, acertoId)))
      .orderBy(asc(ordensServico.numero), asc(osItens.createdAt)),
    db
      .select({ id: vales.id, valorCentavos: vales.valorCentavos, dadoEm: vales.dadoEm })
      .from(vales)
      .where(and(eq(vales.tenantId, ctx.tenantId), eq(vales.acertoId, acertoId)))
      .orderBy(asc(vales.dadoEm)),
  ]);
  return { acerto, comissoes: itens, vales: descontados };
}
