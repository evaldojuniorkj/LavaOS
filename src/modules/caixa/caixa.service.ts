import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { assertPermission } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { caixas, ordensServico, pagamentos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { publicar } from '@/lib/realtime/publicar';
import { formatarReais } from '@/modules/catalogo/catalogo.rules';
import { caixaAbertoQualquer, caixaDoDia, pagamentosDaOs, resumoDoCaixa, type ResumoDoCaixa } from './caixa.repo';
import { dataDoCaixa, diferenca, podeReceber, saldoOs } from './caixa.rules';
import type { abrirCaixaSchema, estornarPagamentoSchema, fecharCaixaSchema, reabrirCaixaSchema, receberSchema } from './caixa.schemas';

/** Recusa de regra com mensagem segura para a tela. */
export class CaixaError extends Error {
  constructor(
    readonly code: 'NAO_ENCONTRADO' | 'CAIXA_ABERTO' | 'CAIXA_FECHADO' | 'CAIXA_DE_OUTRO_DIA' | 'SEM_CAIXA' | 'OS_ENCERRADA' | 'ACIMA_DO_SALDO' | 'JA_ESTORNADO' | 'OCUPADO',
    message: string,
  ) {
    super(message);
    this.name = 'CaixaError';
  }
}

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
const ddmm = (data: string) => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const outroDia = (data: string) => new CaixaError('CAIXA_DE_OUTRO_DIA', `Feche o caixa de ${ddmm(data)} antes.`);
const naoEncontrado = (o: 'Caixa' | 'OS' | 'Pagamento') => new CaixaError('NAO_ENCONTRADO', `${o} não encontrad${o === 'OS' ? 'a' : 'o'}.`);

export async function emTransacao<T>(db: Database, fn: (tx: Tx) => Promise<T>, ocupado = 'O caixa está sendo alterado. Tente novamente.'): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`set local lock_timeout = '5s'`);
      return fn(tx);
    });
  } catch (err) {
    const pg = ((err as { cause?: unknown }).cause ?? err) as { code?: string }; // o Drizzle embrulha o erro do pg em `cause`
    if (pg.code === '55P03') throw new CaixaError('OCUPADO', ocupado);
    // só a inserção/reabertura de caixa bate em unique: outra pessoa abriu um caixa entre a checagem e a gravação
    if (pg.code === '23505') throw new CaixaError('CAIXA_ABERTO', 'O caixa acabou de ser aberto. Recarregue a tela.');
    throw err;
  }
}

/** OS antes do caixa (ordem fixa de travas em receber/estornar/entregar: evita deadlock). */
async function travarOs(tx: Tx, ctx: TenantContext, id: string) {
  const [os] = await tx
    .select({ id: ordensServico.id, status: ordensServico.status, totalCentavos: ordensServico.totalCentavos })
    .from(ordensServico)
    .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, id)))
    .for('update');
  if (!os) throw naoEncontrado('OS'); // inclui OS de outro tenant
  return os;
}

/** FOR SHARE: um fechamento concorrente espera este commit; se fechou antes, o aberto some da consulta e a escrita é recusada. */
export async function caixaAbertoDeHoje(tx: Tx, ctx: TenantContext, agora: Date) {
  const [c] = await tx.select().from(caixas).where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.status, 'aberto'))).for('share');
  if (!c) throw new CaixaError('SEM_CAIXA', 'Abra o caixa de hoje antes.');
  if (c.data !== dataDoCaixa(agora)) throw outroDia(c.data);
  return c;
}

async function travarCaixa(tx: Tx, ctx: TenantContext, id: string) {
  const [c] = await tx.select().from(caixas).where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.id, id))).for('update');
  if (!c) throw naoEncontrado('Caixa');
  return c;
}

const resumo = async (tx: Tx, ctx: TenantContext, id: string) => (await resumoDoCaixa(ctx, id, tx))!;
const saldo = async (tx: Tx, ctx: TenantContext, os: { id: string; totalCentavos: number }) =>
  saldoOs(os.totalCentavos, (await pagamentosDaOs(ctx, os.id, tx)).filter((p) => !p.estornadoEm).map((p) => p.valorCentavos));

/** Abre o caixa de hoje; um aberto de outro dia precisa ser fechado antes e o de hoje fechado só volta por Reabrir. */
export async function abrirCaixa(ctx: TenantContext, i: z.output<typeof abrirCaixaSchema>, db: Database = getDatabase(), agora = new Date()): Promise<ResumoDoCaixa> {
  assertPermission(ctx, 'caixa:operar');
  return emTransacao(db, async (tx) => {
    const hoje = dataDoCaixa(agora);
    const aberto = await caixaAbertoQualquer(ctx, tx);
    if (aberto) throw aberto.data === hoje ? new CaixaError('CAIXA_ABERTO', 'O caixa de hoje já está aberto.') : outroDia(aberto.data);
    if (await caixaDoDia(ctx, agora, tx)) throw new CaixaError('CAIXA_FECHADO', 'O caixa de hoje já foi fechado. Reabra o caixa para continuar.');
    const [c] = await tx.insert(caixas).values({ tenantId: ctx.tenantId, data: hoje, trocoInicialCentavos: i.trocoInicialCentavos, abertoPor: ctx.memberId }).returning({ id: caixas.id });
    await publicar(tx, { tenantId: ctx.tenantId, tipo: 'caixa' });
    return resumo(tx, ctx, c.id);
  });
}

/** Registra um pagamento no caixa aberto de hoje; a soma dos ativos nunca passa do total (decidido com a OS travada). */
export async function receber(ctx: TenantContext, i: z.output<typeof receberSchema>, db: Database = getDatabase(), agora = new Date()): Promise<{ pagamentoId: string; saldoCentavos: number }> {
  assertPermission(ctx, 'caixa:operar');
  return emTransacao(db, async (tx) => {
    const os = await travarOs(tx, ctx, i.osId);
    if (os.status === 'entregue' || os.status === 'cancelada') throw new CaixaError('OS_ENCERRADA', `OS ${os.status} não recebe pagamento.`);
    const caixa = await caixaAbertoDeHoje(tx, ctx, agora);
    const ativos = (await pagamentosDaOs(ctx, os.id, tx)).filter((p) => !p.estornadoEm).map((p) => p.valorCentavos);
    if (!podeReceber(os.totalCentavos, ativos, i.valorCentavos)) {
      const falta = saldoOs(os.totalCentavos, ativos);
      throw new CaixaError('ACIMA_DO_SALDO', falta ? `Falta receber só ${formatarReais(falta)}.` : 'Essa OS já está quitada.');
    }
    const [p] = await tx
      .insert(pagamentos)
      .values({ tenantId: ctx.tenantId, osId: os.id, caixaId: caixa.id, forma: i.forma, valorCentavos: i.valorCentavos, recebidoPor: ctx.memberId })
      .returning({ id: pagamentos.id });
    await publicar(tx, { tenantId: ctx.tenantId, osId: os.id, tipo: 'pagamento' });
    return { pagamentoId: p.id, saldoCentavos: saldoOs(os.totalCentavos, [...ativos, i.valorCentavos]) };
  });
}

/** Estorno só de pagamento do caixa aberto de hoje e nunca em OS entregue (reabrir a OS antes). */
export async function estornarPagamento(ctx: TenantContext, i: z.output<typeof estornarPagamentoSchema>, db: Database = getDatabase(), agora = new Date()): Promise<{ saldoCentavos: number }> {
  assertPermission(ctx, 'caixa:estornar');
  return emTransacao(db, async (tx) => {
    const [alvo] = await tx.select({ osId: pagamentos.osId, caixaId: pagamentos.caixaId }).from(pagamentos).where(and(eq(pagamentos.tenantId, ctx.tenantId), eq(pagamentos.id, i.pagamentoId)));
    if (!alvo) throw naoEncontrado('Pagamento');
    const os = await travarOs(tx, ctx, alvo.osId);
    if (os.status === 'entregue') throw new CaixaError('OS_ENCERRADA', 'Reabra a OS antes de estornar.');
    const caixa = await caixaAbertoDeHoje(tx, ctx, agora);
    if (caixa.id !== alvo.caixaId) throw new CaixaError('CAIXA_FECHADO', 'Só dá para estornar pagamento do caixa aberto de hoje.');
    const [ok] = await tx
      .update(pagamentos)
      .set({ estornadoEm: sql`now()`, estornadoPor: ctx.memberId, motivoEstorno: i.motivo })
      .where(and(eq(pagamentos.tenantId, ctx.tenantId), eq(pagamentos.id, i.pagamentoId), isNull(pagamentos.estornadoEm)))
      .returning({ id: pagamentos.id });
    if (!ok) throw new CaixaError('JA_ESTORNADO', 'Esse pagamento já foi estornado.');
    await publicar(tx, { tenantId: ctx.tenantId, osId: os.id, tipo: 'pagamento' });
    return { saldoCentavos: await saldo(tx, ctx, os) };
  });
}

/** Fecha o caixa aberto (de hoje ou esquecido): o FOR UPDATE espera recebimentos em curso, então o esperado inclui todos. */
export async function fecharCaixa(ctx: TenantContext, i: z.output<typeof fecharCaixaSchema>, db: Database = getDatabase()): Promise<ResumoDoCaixa> {
  assertPermission(ctx, 'caixa:operar');
  return emTransacao(db, async (tx) => {
    const c = await travarCaixa(tx, ctx, i.caixaId);
    if (c.status === 'fechado') throw new CaixaError('CAIXA_FECHADO', 'Esse caixa já foi fechado.');
    const { esperadoDinheiro } = await resumo(tx, ctx, c.id);
    await tx
      .update(caixas)
      .set({ status: 'fechado', fechadoPor: ctx.memberId, fechadoEm: sql`now()`, dinheiroContadoCentavos: i.dinheiroContadoCentavos, diferencaCentavos: diferenca(i.dinheiroContadoCentavos, esperadoDinheiro) })
      .where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.id, c.id)));
    await publicar(tx, { tenantId: ctx.tenantId, tipo: 'caixa' });
    return resumo(tx, ctx, c.id);
  });
}

/** Só o caixa de hoje, e só se nenhum outro estiver aberto; contado e diferença voltam a null. */
export async function reabrirCaixa(ctx: TenantContext, i: z.output<typeof reabrirCaixaSchema>, db: Database = getDatabase(), agora = new Date()): Promise<ResumoDoCaixa> {
  assertPermission(ctx, 'caixa:reabrir');
  return emTransacao(db, async (tx) => {
    const c = await travarCaixa(tx, ctx, i.caixaId);
    if (c.status === 'aberto') throw new CaixaError('CAIXA_ABERTO', 'Esse caixa já está aberto.');
    if (c.data !== dataDoCaixa(agora)) throw new CaixaError('CAIXA_DE_OUTRO_DIA', 'Só o caixa de hoje pode ser reaberto.');
    const outro = await caixaAbertoQualquer(ctx, tx);
    if (outro) throw outroDia(outro.data); // um caixa por dia: o aberto só pode ser de outro dia
    await tx
      .update(caixas)
      .set({ status: 'aberto', fechadoPor: null, fechadoEm: null, dinheiroContadoCentavos: null, diferencaCentavos: null })
      .where(and(eq(caixas.tenantId, ctx.tenantId), eq(caixas.id, c.id)));
    await publicar(tx, { tenantId: ctx.tenantId, tipo: 'caixa' });
    return resumo(tx, ctx, c.id);
  });
}
