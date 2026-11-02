'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { CaixaError } from '@/modules/caixa/caixa.service';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { DespesasError } from '@/modules/despesas/despesas.service';
import { cancelarValeSchema, lancarValeSchema, pagarAcertoSchema, previaAcertoSchema } from './comissoes.schemas';
import { cancelarVale, ComissoesError, lancarVale, pagarAcerto, previaAcerto } from './comissoes.service';

/** Permissão, validação estrita e serviço; o serviço confere a permissão de novo. */
async function executar<S extends z.ZodType, T>(schema: S, input: unknown, fn: (ctx: TenantContext, data: z.output<S>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(await headers(), 'comissoes:gerenciar');
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    if (err instanceof ComissoesError || err instanceof CaixaError) return { ok: false, code: err.code, message: err.message };
    // vale e acerto viram despesa: caixa fechado na hora de cancelar, categoria desativada
    if (err instanceof DespesasError) return { ok: false, code: err.code, message: err.message, ...(err.fieldErrors && { fieldErrors: err.fieldErrors }) };
    console.error('[comissoes] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function lancarValeAction(input: unknown) {
  return executar(lancarValeSchema, input, (ctx, d) => lancarVale(ctx, d));
}

export async function cancelarValeAction(input: unknown) {
  return executar(cancelarValeSchema, input, (ctx, d) => cancelarVale(ctx, d));
}

export async function previaAcertoAction(input: unknown) {
  return executar(previaAcertoSchema, input, (ctx, d) => previaAcerto(ctx, d));
}

export async function pagarAcertoAction(input: unknown) {
  return executar(pagarAcertoSchema, input, (ctx, d) => pagarAcerto(ctx, d));
}
