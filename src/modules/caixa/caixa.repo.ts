import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { caixas, despesas, membros, ordensServico, pagamentos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { dataDoCaixa, resumoCaixa } from './caixa.rules';

/** Database ou transação: só leitura. */
type Leitor = Pick<Database, 'select'>;

export async function caixaDoDia(ctx: TenantContext, agora = new Date(), db: Leitor = getDatabase()) {
  const [c] = await db.select().from(caixas).where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.data, dataDoCaixa(agora))));
  return c ?? null;
}

/** O aberto, de hoje ou esquecido de outro dia (o banco garante no máximo um). */
export async function caixaAbertoQualquer(ctx: TenantContext, db: Leitor = getDatabase()) {
  const [c] = await db.select().from(caixas).where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.status, 'aberto')));
  return c ?? null;
}

export function pagamentosDaOs(ctx: TenantContext, osId: string, db: Leitor = getDatabase()) {
  return db
    .select()
    .from(pagamentos)
    .where(and(eq(pagamentos.tenantId, ctx.tenantId), eq(pagamentos.osId, osId)))
    .orderBy(asc(pagamentos.recebidoEm), asc(pagamentos.id));
}

/** Caixa, pagamentos (com número da OS e quem recebeu), saídas de dinheiro ativas e o esperado; null se não for do tenant. */
export async function resumoDoCaixa(ctx: TenantContext, caixaId: string, db: Leitor = getDatabase()) {
  const [caixa] = await db.select().from(caixas).where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.id, caixaId)));
  if (!caixa) return null;
  const lista = await db
    .select({
      id: pagamentos.id,
      osId: pagamentos.osId,
      osNumero: ordensServico.numero,
      forma: pagamentos.forma,
      valorCentavos: pagamentos.valorCentavos,
      recebidoPor: membros.nomeExibicao,
      recebidoEm: pagamentos.recebidoEm,
      estornadoEm: pagamentos.estornadoEm,
      motivoEstorno: pagamentos.motivoEstorno,
    })
    .from(pagamentos)
    .innerJoin(ordensServico, and(eq(ordensServico.tenantId, pagamentos.tenantId), eq(ordensServico.id, pagamentos.osId)))
    .innerJoin(membros, and(eq(membros.tenantId, pagamentos.tenantId), eq(membros.id, pagamentos.recebidoPor)))
    .where(and(eq(pagamentos.tenantId, ctx.tenantId), eq(pagamentos.caixaId, caixaId)))
    .orderBy(asc(pagamentos.recebidoEm), asc(pagamentos.id));
  const saidas = await db
    .select({ id: despesas.id, descricao: despesas.descricao, valorCentavos: despesas.valorCentavos, pagoEm: despesas.pagoEm })
    .from(despesas)
    .where(and(eq(despesas.tenantId, ctx.tenantId), eq(despesas.caixaId, caixaId), isNull(despesas.canceladaEm)))
    .orderBy(asc(despesas.pagoEm), asc(despesas.id));
  const r = resumoCaixa({
    trocoInicial: caixa.trocoInicialCentavos,
    pagamentos: lista.map((p) => ({ forma: p.forma, valorCentavos: p.valorCentavos, estornado: p.estornadoEm !== null })),
    saidasDinheiro: saidas.map((s) => s.valorCentavos),
  });
  return { caixa, pagamentos: lista, saidas, ...r };
}
export type ResumoDoCaixa = NonNullable<Awaited<ReturnType<typeof resumoDoCaixa>>>;

/** O aberto (de hoje ou esquecido de outro dia) ou, sem aberto, o de hoje; `resumo` null = nenhum caixa hoje. */
export async function caixaAtual(ctx: TenantContext, agora = new Date(), db: Leitor = getDatabase()) {
  const c = (await caixaAbertoQualquer(ctx, db)) ?? (await caixaDoDia(ctx, agora, db));
  return { hoje: dataDoCaixa(agora), resumo: c && (await resumoDoCaixa(ctx, c.id, db)) };
}
export type CaixaAtual = Awaited<ReturnType<typeof caixaAtual>>;
