import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { assertPermission } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { categoriasDespesa, despesas } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { publicar } from '@/lib/realtime/publicar';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';
import { caixaAbertoDeHoje, emTransacao, type Tx } from '@/modules/caixa/caixa.service';
import { camposCategoria, camposDespesa, type Categoria, type Despesa } from './despesas.repo';
import type { cancelarDespesaSchema, lancarDespesaSchema, marcarComoPagaSchema, salvarCategoriaSchema } from './despesas.schemas';

/** Recusa de regra com mensagem segura para a tela; `fieldErrors` aponta o campo. */
export class DespesasError extends Error {
  constructor(
    readonly code: 'VALIDACAO' | 'NAO_ENCONTRADO' | 'JA_PAGA' | 'CANCELADA' | 'JA_CANCELADA' | 'CAIXA_FECHADO' | 'CATEGORIA_SISTEMA',
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'DespesasError';
  }
}
const erroCampo = (campo: string, msg: string) => new DespesasError('VALIDACAO', 'Dados inválidos.', { [campo]: [msg] });
const violouUnique = (err: unknown) => [err, (err as { cause?: unknown })?.cause].some((e) => (e as { code?: string } | null)?.code === '23505');
// shortcut: data passada vira meio-dia em São Paulo (sem horário de verão desde 2019); se a tela pedir hora, receber o instante.
const meioDia = (data: string) => new Date(`${data}T12:00:00-03:00`);

/** Despesa antes do caixa (mesma ordem de travas de OS → caixa). */
async function travarDespesa(tx: Tx, ctx: TenantContext, id: string) {
  const [d] = await tx.select(camposDespesa).from(despesas).where(and(eq(despesas.tenantId, ctx.tenantId), eq(despesas.id, id))).for('update');
  if (!d) throw new DespesasError('NAO_ENCONTRADO', 'Despesa não encontrada.'); // inclui despesa de outro tenant
  return d;
}

/** `doCaixa`: saiu dinheiro da gaveta hoje; grava no caixa aberto de hoje e entra nas saídas do fechamento. */
export async function lancarDespesa(ctx: TenantContext, i: z.output<typeof lancarDespesaSchema>, db: Database = getDatabase(), agora = new Date()): Promise<Despesa> {
  assertPermission(ctx, 'despesas:gerenciar');
  const hoje = dataDoCaixa(agora);
  const pagoEm = i.doCaixa ? (i.pagoEm ?? hoje) : i.pagoEm;
  if (!pagoEm && !i.vencimento) throw erroCampo('vencimento', 'Informe a data do pagamento ou o vencimento.');
  if (pagoEm && pagoEm > hoje) throw erroCampo('pagoEm', 'A data do pagamento não pode ser no futuro.');
  if (i.doCaixa && pagoEm !== hoje) throw erroCampo('pagoEm', 'Dinheiro do caixa só com pagamento hoje.');
  return emTransacao(db, async (tx) => {
    const [cat] = await tx
      .select({ id: categoriasDespesa.id })
      .from(categoriasDespesa)
      .where(and(eq(categoriasDespesa.tenantId, ctx.tenantId), eq(categoriasDespesa.id, i.categoriaId), eq(categoriasDespesa.ativo, true)));
    if (!cat) throw erroCampo('categoriaId', 'Categoria não encontrada.');
    const caixa = i.doCaixa ? await caixaAbertoDeHoje(tx, ctx, agora) : null;
    const [d] = await tx
      .insert(despesas)
      .values({
        tenantId: ctx.tenantId,
        categoriaId: cat.id,
        descricao: i.descricao,
        valorCentavos: i.valorCentavos,
        vencimento: i.vencimento,
        pagoEm: !pagoEm ? null : pagoEm === hoje ? agora : meioDia(pagoEm),
        caixaId: caixa?.id,
        lancadaPor: ctx.memberId,
      })
      .returning(camposDespesa);
    if (caixa) await publicar(tx, { tenantId: ctx.tenantId, tipo: 'caixa' });
    return d;
  });
}

export async function marcarComoPaga(ctx: TenantContext, i: z.output<typeof marcarComoPagaSchema>, db: Database = getDatabase(), agora = new Date()): Promise<Despesa> {
  assertPermission(ctx, 'despesas:gerenciar');
  return emTransacao(db, async (tx) => {
    const d = await travarDespesa(tx, ctx, i.despesaId);
    if (d.canceladaEm) throw new DespesasError('CANCELADA', 'Despesa cancelada não pode ser paga.');
    if (d.pagoEm) throw new DespesasError('JA_PAGA', 'Essa despesa já foi paga.');
    const caixa = i.doCaixa ? await caixaAbertoDeHoje(tx, ctx, agora) : null;
    const [p] = await tx
      .update(despesas)
      .set({ pagoEm: agora, caixaId: caixa?.id })
      .where(and(eq(despesas.tenantId, ctx.tenantId), eq(despesas.id, d.id)))
      .returning(camposDespesa);
    if (caixa) await publicar(tx, { tenantId: ctx.tenantId, tipo: 'caixa' });
    return p;
  });
}

/** Saída do caixa só cancela com o caixa ainda aberto: a trava FOR SHARE faz um fechamento concorrente ver o cancelamento. */
export async function cancelarDespesa(ctx: TenantContext, i: z.output<typeof cancelarDespesaSchema>, db: Database = getDatabase(), agora = new Date()): Promise<Despesa> {
  assertPermission(ctx, 'despesas:gerenciar');
  return emTransacao(db, async (tx) => {
    const d = await travarDespesa(tx, ctx, i.despesaId);
    if (d.canceladaEm) throw new DespesasError('JA_CANCELADA', 'Essa despesa já foi cancelada.');
    if (d.caixaId && (await caixaAbertoDeHoje(tx, ctx, agora)).id !== d.caixaId) {
      throw new DespesasError('CAIXA_FECHADO', 'Só dá para cancelar saída do caixa aberto de hoje.');
    }
    const [c] = await tx
      .update(despesas)
      .set({ canceladaEm: sql`now()`, canceladaPor: ctx.memberId, motivoCancelamento: i.motivo })
      .where(and(eq(despesas.tenantId, ctx.tenantId), eq(despesas.id, d.id)))
      .returning(camposDespesa);
    if (d.caixaId) await publicar(tx, { tenantId: ctx.tenantId, tipo: 'caixa' });
    return c;
  });
}

/** Categoria de sistema ("Comissões", usada pela Fase 5) não é renomeada nem desativada. */
export async function salvarCategoria(ctx: TenantContext, { id, ...dados }: z.output<typeof salvarCategoriaSchema>, db: Database = getDatabase()): Promise<Categoria> {
  assertPermission(ctx, 'despesas:gerenciar');
  const onde = (catId: string) => and(eq(categoriasDespesa.tenantId, ctx.tenantId), eq(categoriasDespesa.id, catId));
  try {
    if (!id) return (await db.insert(categoriasDespesa).values({ ...dados, tenantId: ctx.tenantId }).returning(camposCategoria))[0];
    const [atual] = await db.select(camposCategoria).from(categoriasDespesa).where(onde(id));
    if (!atual) throw new DespesasError('NAO_ENCONTRADO', 'Categoria não encontrada.');
    if (atual.sistema && (dados.nome !== atual.nome || dados.ativo === false)) {
      throw new DespesasError('CATEGORIA_SISTEMA', `"${atual.nome}" é usada pelo sistema e não pode ser renomeada nem desativada.`);
    }
    return (await db.update(categoriasDespesa).set(dados).where(onde(id)).returning(camposCategoria))[0];
  } catch (err) {
    if (violouUnique(err)) throw erroCampo('nome', 'Já existe uma categoria com esse nome.'); // unique (tenant, nome)
    throw err;
  }
}
