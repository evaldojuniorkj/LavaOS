import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { acertosComissao, comissoes, ordensServico, osItens } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { basesDosItens, comissaoDoItem } from './comissoes.rules';

/** Recusa de regra com mensagem segura para a tela. */
export class ComissoesError extends Error {
  constructor(
    readonly code: 'COMISSAO_PAGA',
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
