import 'server-only';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { acertosComissao, categoriasDespesa, despesas, vales } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { dataDoCaixa } from '@/modules/caixa/caixa.rules';

type Leitor = Pick<Database, 'select'>;

export const camposDespesa = {
  id: despesas.id,
  categoriaId: despesas.categoriaId,
  descricao: despesas.descricao,
  valorCentavos: despesas.valorCentavos,
  vencimento: despesas.vencimento,
  pagoEm: despesas.pagoEm,
  caixaId: despesas.caixaId,
  canceladaEm: despesas.canceladaEm,
  motivoCancelamento: despesas.motivoCancelamento,
};
export type Despesa = Pick<typeof despesas.$inferSelect, keyof typeof camposDespesa>;
export type Categoria = Pick<typeof categoriasDespesa.$inferSelect, 'id' | 'nome' | 'ativo' | 'sistema'>;
export const camposCategoria = { id: categoriasDespesa.id, nome: categoriasDespesa.nome, ativo: categoriasDespesa.ativo, sistema: categoriasDespesa.sistema };

// vale e acerto só se cancelam (ou não) por Comissões: a tela esconde o "Cancelar"
const ligadaAComissao = sql<boolean>`(exists (select 1 from ${vales} where ${vales.tenantId} = ${despesas.tenantId} and ${vales.despesaId} = ${despesas.id}) or exists (select 1 from ${acertosComissao} where ${acertosComissao.tenantId} = ${despesas.tenantId} and ${acertosComissao.despesaId} = ${despesas.id}))`;

const comCategoria = (db: Leitor) =>
  db
    .select({ ...camposDespesa, categoria: categoriasDespesa.nome, deComissao: ligadaAComissao })
    .from(despesas)
    .innerJoin(categoriasDespesa, and(eq(categoriasDespesa.tenantId, despesas.tenantId), eq(categoriasDespesa.id, despesas.categoriaId)));

// dia da despesa: o do pagamento em São Paulo ou, se ainda a pagar, o vencimento
const diaDaDespesa = sql<string>`coalesce((${despesas.pagoEm} at time zone 'America/Sao_Paulo')::date, ${despesas.vencimento})`;

/** Despesas (inclusive canceladas e a pagar) cujo dia cai entre `de` e `ate` (`YYYY-MM-DD`, inclusive). */
export function listarDespesas(ctx: TenantContext, { de, ate }: { de: string; ate: string }, db: Leitor = getDatabase()) {
  return comCategoria(db)
    .where(and(eq(despesas.tenantId, ctx.tenantId), sql`${diaDaDespesa} between ${de} and ${ate}`))
    .orderBy(desc(diaDaDespesa), desc(despesas.createdAt));
}

/** A pagar e não canceladas, por vencimento; vencida = vencimento antes de hoje em São Paulo. */
export async function contasAPagar(ctx: TenantContext, agora = new Date(), db: Leitor = getDatabase()) {
  const hoje = dataDoCaixa(agora);
  const lista = await comCategoria(db)
    .where(and(eq(despesas.tenantId, ctx.tenantId), isNull(despesas.pagoEm), isNull(despesas.canceladaEm)))
    .orderBy(asc(despesas.vencimento), asc(despesas.createdAt));
  return lista.map((d) => ({ ...d, vencida: d.vencimento! < hoje })); // a pagar sempre tem vencimento (despesas_data_ck)
}

export function listarCategorias(ctx: TenantContext, db: Leitor = getDatabase()) {
  return db.select(camposCategoria).from(categoriasDespesa).where(eq(categoriasDespesa.tenantId, ctx.tenantId)).orderBy(asc(categoriasDespesa.nome));
}
