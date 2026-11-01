'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { Permissao, TenantContext } from '@/lib/auth/types';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import type { ResumoDoCaixa } from './caixa.repo';
import { abrirCaixaSchema, estornarPagamentoSchema, fecharCaixaSchema, reabrirCaixaSchema, receberSchema } from './caixa.schemas';
import { abrirCaixa, CaixaError, estornarPagamento, fecharCaixa, reabrirCaixa, receber } from './caixa.service';

/** Permissão, validação estrita e serviço; o serviço confere a permissão de novo. */
async function executar<S extends z.ZodType, T>(permissao: Permissao, schema: S, input: unknown, fn: (ctx: TenantContext, data: z.output<S>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(await headers(), permissao);
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    if (err instanceof CaixaError) return { ok: false, code: err.code, message: err.message };
    console.error('[caixa] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function abrirCaixaAction(input: unknown): Promise<ActionResult<ResumoDoCaixa>> {
  return executar('caixa:operar', abrirCaixaSchema, input, (ctx, d) => abrirCaixa(ctx, d));
}

export async function receberAction(input: unknown): Promise<ActionResult<{ pagamentoId: string; saldoCentavos: number }>> {
  return executar('caixa:operar', receberSchema, input, (ctx, d) => receber(ctx, d));
}

export async function estornarPagamentoAction(input: unknown): Promise<ActionResult<{ saldoCentavos: number }>> {
  return executar('caixa:estornar', estornarPagamentoSchema, input, (ctx, d) => estornarPagamento(ctx, d));
}

export async function fecharCaixaAction(input: unknown): Promise<ActionResult<ResumoDoCaixa>> {
  return executar('caixa:operar', fecharCaixaSchema, input, (ctx, d) => fecharCaixa(ctx, d));
}

export async function reabrirCaixaAction(input: unknown): Promise<ActionResult<ResumoDoCaixa>> {
  return executar('caixa:reabrir', reabrirCaixaSchema, input, (ctx, d) => reabrirCaixa(ctx, d));
}
