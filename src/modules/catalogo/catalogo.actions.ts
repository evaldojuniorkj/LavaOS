'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import type { Porte, ServicoComPrecos } from './catalogo.repo';
import { definirPrecoSchema, salvarPorteSchema, salvarServicoSchema } from './catalogo.schemas';
import { CatalogoError, definirPreco, salvarPorte, salvarServico } from './catalogo.service';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

/** Permissão base, depois validação estrita, depois o serviço. Nada é gravado antes disso. */
async function executar<S extends z.ZodType, T>(schema: S, input: unknown, fn: (ctx: TenantContext, data: z.output<S>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(await headers(), 'catalogo:gerenciar');
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    if (err instanceof CatalogoError) return { ok: false, code: err.code, message: err.message };
    console.error('[catalogo] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function salvarPorteAction(input: unknown): Promise<ActionResult<Porte>> {
  return executar(salvarPorteSchema, input, salvarPorte);
}

export async function salvarServicoAction(input: unknown): Promise<ActionResult<Omit<ServicoComPrecos, 'precos'>>> {
  return executar(salvarServicoSchema, input, salvarServico);
}

export async function definirPrecoAction(input: unknown) {
  return executar(definirPrecoSchema, input, definirPreco);
}
