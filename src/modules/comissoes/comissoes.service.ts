import 'server-only';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { assertPermission } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { acertosComissao, categoriasDespesa, comissoes, membros, ordensServico, osItens, vales } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { emTransacao } from '@/modules/caixa/caixa.service';
import { cancelarDespesaTx, lancarDespesaTx } from '@/modules/despesas/despesas.service';
import { comissoesPendentes, saldoAnterior, valesPendentes } from './comissoes.repo';
import { basesDosItens, calcularAcerto, comissaoDoItem } from './comissoes.rules';
import type { cancelarValeSchema, lancarValeSchema, pagarAcertoSchema, previaAcertoSchema } from './comissoes.schemas';

/** Recusa de regra com mensagem segura para a tela. */
export class ComissoesError extends Error {
  constructor(
    readonly code: 'COMISSAO_PAGA' | 'VALIDACAO' | 'NAO_ENCONTRADO' | 'SEM_PENDENCIA' | 'JA_CANCELADO' | 'VALE_EM_ACERTO',
    message: string,
  ) {
    super(message);
    this.name = 'ComissoesError';
  }
}

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Na entrega, com a OS já travada por quem chama: uma comissão por item, toda para o responsável. */
export async function gerarComissoes(tx: Tx, ctx: TenantContext, osId: string) {
  const [os] = await tx
    .select({ responsavelId: ordensServico.responsavelId, desconto: ordensServico.descontoCentavos, acrescimo: ordensServico.acrescimoCentavos })
    .from(ordensServico)
    .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, osId)));
  // ordem estável: o desempate da sobra do rateio é "o primeiro item"
  const itens = await tx
    .select({ id: osItens.id, valor: osItens.valorCentavos, tipo: osItens.comissaoTipo, comissao: osItens.comissaoValor })
    .from(osItens)
    .where(and(eq(osItens.tenantId, ctx.tenantId), eq(osItens.osId, osId)))
    .orderBy(asc(osItens.createdAt), asc(osItens.id));
  if (!itens.length) return;
  const bases = basesDosItens(itens.map((i) => i.valor), os.desconto, os.acrescimo);
  await tx
    .insert(comissoes)
    .values(
      itens.map((it, k) => ({
        tenantId: ctx.tenantId,
        osId,
        osItemId: it.id,
        membroId: os.responsavelId!, // a entrega já exige responsável
        baseCentavos: bases[k],
        valorCentavos: comissaoDoItem(bases[k], it.tipo, it.comissao),
      })),
    )
    .onConflictDoNothing({ target: [comissoes.tenantId, comissoes.osItemId] });
}

/** Na reabertura: comissão já acertada é dinheiro pago, então a OS não volta; as pendentes são refeitas na próxima entrega. */
export async function removerComissoesPendentes(tx: Tx, ctx: TenantContext, osId: string) {
  // FOR UPDATE: um acerto concorrente que vincule estas linhas espera, ou já gravou e é visto aqui
  const linhas = await tx
    .select({ acertoId: comissoes.acertoId })
    .from(comissoes)
    .where(and(eq(comissoes.tenantId, ctx.tenantId), eq(comissoes.osId, osId)))
    .for('update');
  const acertoId = linhas.find((l) => l.acertoId)?.acertoId;
  if (acertoId) {
    const [a] = await tx
      .select({ pagoEm: acertosComissao.pagoEm })
      .from(acertosComissao)
      .where(and(eq(acertosComissao.tenantId, ctx.tenantId), eq(acertosComissao.id, acertoId)));
    const d = dataDoCaixa(a.pagoEm);
    throw new ComissoesError('COMISSAO_PAGA', `Comissão já paga no acerto de ${d.slice(8, 10)}/${d.slice(5, 7)}.`);
  }
  await tx.delete(comissoes).where(and(eq(comissoes.tenantId, ctx.tenantId), eq(comissoes.osId, osId)));
}

const ocupado = 'Esse membro está em acerto agora. Tente novamente.';
const naoEncontrado = (o: 'Membro' | 'Vale') => new ComissoesError('NAO_ENCONTRADO', `${o} não encontrado.`);

/** Serializa vales e acertos do mesmo membro; NO KEY UPDATE não bloqueia quem só referencia o membro (entrega, FKs). */
async function travarMembro(tx: Tx, ctx: TenantContext, membroId: string) {
  const [m] = await tx
    .select({ id: membros.id, nome: membros.nomeExibicao, ativo: membros.ativo })
    .from(membros)
    .where(and(eq(membros.tenantId, ctx.tenantId), eq(membros.id, membroId)))
    .for('no key update');
  if (!m) throw naoEncontrado('Membro'); // inclui membro de outro tenant
  return m;
}

async function categoria(tx: Tx, ctx: TenantContext, nome: 'Vales' | 'Comissões') {
  const [c] = await tx.select({ id: categoriasDespesa.id }).from(categoriasDespesa).where(and(eq(categoriasDespesa.tenantId, ctx.tenantId), eq(categoriasDespesa.nome, nome)));
  if (!c) throw new ComissoesError('NAO_ENCONTRADO', `Categoria de despesa "${nome}" não encontrada.`);
  return c.id;
}

function conferirData(ate: string, agora: Date) {
  if (ate > dataDoCaixa(agora)) throw new ComissoesError('VALIDACAO', 'A data do acerto não pode ser no futuro.');
}

/** O vale já é despesa paga quando é dado; o acerto só o desconta. */
export async function lancarVale(ctx: TenantContext, i: z.output<typeof lancarValeSchema>, db: Database = getDatabase(), agora = new Date()) {
  assertPermission(ctx, 'comissoes:gerenciar');
  return emTransacao(
    db,
    async (tx) => {
      const m = await travarMembro(tx, ctx, i.membroId);
      if (!m.ativo) throw naoEncontrado('Membro');
      const d = await lancarDespesaTx(tx, ctx, { categoriaId: await categoria(tx, ctx, 'Vales'), descricao: `Vale de ${m.nome}`, valorCentavos: i.valorCentavos, pagoEm: dataDoCaixa(agora), doCaixa: i.doCaixa }, agora);
      const [v] = await tx.insert(vales).values({ tenantId: ctx.tenantId, membroId: m.id, valorCentavos: i.valorCentavos, dadoEm: agora, dadoPor: ctx.memberId, despesaId: d.id }).returning();
      return v;
    },
    ocupado,
  );
}

/** Só vale pendente; a despesa é cancelada junto (e, se saiu do caixa, exige o caixa de hoje aberto). */
export async function cancelarVale(ctx: TenantContext, i: z.output<typeof cancelarValeSchema>, db: Database = getDatabase(), agora = new Date()) {
  assertPermission(ctx, 'comissoes:gerenciar');
  return emTransacao(
    db,
    async (tx) => {
      const onde = and(eq(vales.tenantId, ctx.tenantId), eq(vales.id, i.valeId));
      const [alvo] = await tx.select({ membroId: vales.membroId }).from(vales).where(onde);
      if (!alvo) throw naoEncontrado('Vale');
      await travarMembro(tx, ctx, alvo.membroId);
      const [v] = await tx.select().from(vales).where(onde).for('update');
      if (v.canceladoEm) throw new ComissoesError('JA_CANCELADO', 'Esse vale já foi cancelado.');
      if (v.acertoId) throw new ComissoesError('VALE_EM_ACERTO', 'Vale já descontado num acerto não pode ser cancelado.');
      await cancelarDespesaTx(tx, ctx, { despesaId: v.despesaId, motivo: i.motivo }, agora);
      const [c] = await tx.update(vales).set({ canceladoEm: sql`now()`, canceladoPor: ctx.memberId, motivoCancelamento: i.motivo }).where(onde).returning();
      return c;
    },
    ocupado,
  );
}

/** O que o acerto daria agora, sem gravar. */
export async function previaAcerto(ctx: TenantContext, i: z.output<typeof previaAcertoSchema>, db: Database = getDatabase(), agora = new Date()) {
  assertPermission(ctx, 'comissoes:gerenciar');
  conferirData(i.ate, agora);
  const [com, val, saldo] = await Promise.all([
    db.select({ v: comissoes.valorCentavos }).from(comissoes).where(and(comissoesPendentes(ctx, i.ate), eq(comissoes.membroId, i.membroId))),
    db.select({ v: vales.valorCentavos }).from(vales).where(and(valesPendentes(ctx, i.ate), eq(vales.membroId, i.membroId))),
    saldoAnterior(ctx, i.membroId, db),
  ]);
  return calcularAcerto({ comissoes: com.map((c) => c.v), vales: val.map((v) => v.v), saldoAnterior: saldo });
}

/**
 * Vincula as pendências até `ate` e lança como despesa "Comissões" só o que foi pago.
 * Travas: membro → comissões (via UPDATE) → caixa; nunca a OS, para não cruzar com a reabertura.
 */
export async function pagarAcerto(ctx: TenantContext, i: z.output<typeof pagarAcertoSchema>, db: Database = getDatabase(), agora = new Date()) {
  assertPermission(ctx, 'comissoes:gerenciar');
  conferirData(i.ate, agora);
  return emTransacao(
    db,
    async (tx) => {
      const m = await travarMembro(tx, ctx, i.membroId);
      const saldo = await saldoAnterior(ctx, m.id, tx);
      // nasce zerado (passa nos checks) e recebe os totais do que o UPDATE de fato vinculou: uma reabertura concorrente pode ter apagado comissões
      const [a] = await tx
        .insert(acertosComissao)
        .values({ tenantId: ctx.tenantId, membroId: m.id, periodoInicio: i.ate, periodoFim: i.ate, comissoesCentavos: 0, valesCentavos: 0, saldoAnteriorCentavos: 0, pagoCentavos: 0, saldoDevedorCentavos: 0, pagoEm: agora, pagoPor: ctx.memberId })
        .returning({ id: acertosComissao.id });
      const com = await tx
        .update(comissoes)
        .set({ acertoId: a.id })
        .where(and(comissoesPendentes(ctx, i.ate), eq(comissoes.membroId, m.id)))
        .returning({ v: comissoes.valorCentavos, em: comissoes.geradaEm });
      const val = await tx
        .update(vales)
        .set({ acertoId: a.id })
        .where(and(valesPendentes(ctx, i.ate), eq(vales.membroId, m.id)))
        .returning({ v: vales.valorCentavos, em: vales.dadoEm });
      if (!com.length && !val.length) throw new ComissoesError('SEM_PENDENCIA', 'Nada para acertar até essa data.');
      const conta = calcularAcerto({ comissoes: com.map((c) => c.v), vales: val.map((v) => v.v), saldoAnterior: saldo });
      const despesa = conta.pagoCentavos
        ? await lancarDespesaTx(tx, ctx, { categoriaId: await categoria(tx, ctx, 'Comissões'), descricao: `Acerto de ${m.nome}`, valorCentavos: conta.pagoCentavos, pagoEm: dataDoCaixa(agora), doCaixa: i.doCaixa }, agora)
        : null;
      const inicio = [...com, ...val].map((x) => dataDoCaixa(x.em)).sort()[0];
      const [feito] = await tx
        .update(acertosComissao)
        .set({ ...conta, periodoInicio: inicio, despesaId: despesa?.id })
        .where(and(eq(acertosComissao.tenantId, ctx.tenantId), eq(acertosComissao.id, a.id)))
        .returning();
      return feito;
    },
    ocupado,
  );
}
