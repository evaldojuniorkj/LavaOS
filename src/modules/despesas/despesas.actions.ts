'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { CaixaError } from '@/modules/caixa/caixa.service';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import type { Categoria, Despesa } from './despesas.repo';
import { cancelarDespesaSchema, lancarDespesaSchema, marcarComoPagaSchema, salvarCategoriaSchema } from './despesas.schemas';
import { cancelarDespesa, DespesasError, lancarDespesa, marcarComoPaga, salvarCategoria } from './despesas.service';

/** Permissão, validação estrita e serviço; o serviço confere a permissão de novo. */
async function executar<S extends z.ZodType, T>(schema: S, input: unknown, fn: (ctx: TenantContext, data: z.output<S>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(await headers(), 'despesas:gerenciar');
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    if (err instanceof DespesasError) return { ok: false, code: err.code, message: err.message, ...(err.fieldErrors && { fieldErrors: err.fieldErrors }) };
    if (err instanceof CaixaError) return { ok: false, code: err.code, message: err.message }; // saída de dinheiro: caixa fechado, de outro dia ou ocupado
    console.error('[despesas] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function lancarDespesaAction(input: unknown): Promise<ActionResult<Despesa>> {
  return executar(lancarDespesaSchema, input, (ctx, d) => lancarDespesa(ctx, d));
}

export async function marcarComoPagaAction(input: unknown): Promise<ActionResult<Despesa>> {
  return executar(marcarComoPagaSchema, input, (ctx, d) => marcarComoPaga(ctx, d));
}

export async function cancelarDespesaAction(input: unknown): Promise<ActionResult<Despesa>> {
  return executar(cancelarDespesaSchema, input, (ctx, d) => cancelarDespesa(ctx, d));
}

export async function salvarCategoriaAction(input: unknown): Promise<ActionResult<Categoria>> {
  return executar(salvarCategoriaSchema, input, (ctx, d) => salvarCategoria(ctx, d));
}
