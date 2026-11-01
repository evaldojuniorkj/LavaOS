'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { Permissao, TenantContext } from '@/lib/auth/types';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { listarEntreguesHoje, listarFila, listarLavadoresParaDirecionar, obterOs } from './ordens.repo';
import { abrirOsSchema, obterOsSchema, ajustarValorSchema, atribuirResponsavelSchema, editarItensSchema, transitarOsSchema } from './ordens.schemas';
import { abrirOs, ajustarValor, atribuirResponsavel, ConflitoOsError, editarItens, OrdensError, transitarOs } from './ordens.service';
import type { OsView } from './ordens.views';

/** Permissão, validação estrita e serviço; a resposta ao lavador já sai sem valores (toOsView). */
async function executar<S extends z.ZodType, T>(permissao: Permissao, schema: S, input: unknown, fn: (ctx: TenantContext, data: z.output<S>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(await headers(), permissao);
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission ou pelo serviço
    if (err instanceof ConflitoOsError) return { ok: false, code: err.code, message: err.message };
    if (err instanceof OrdensError) return { ok: false, code: err.code, message: err.message, ...(err.fieldErrors && { fieldErrors: err.fieldErrors }) };
    console.error('[ordens] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function abrirOsAction(input: unknown): Promise<ActionResult<OsView>> {
  return executar('os:abrir', abrirOsSchema, input, abrirOs);
}

/** os:avancar é de todos; a permissão exata da transição (assumir, atribuir, corrigir…) o serviço decide sobre a OS travada. */
export async function transitarOsAction(input: unknown): Promise<ActionResult<OsView>> {
  return executar('os:avancar', transitarOsSchema, input, transitarOs);
}

export async function atribuirResponsavelAction(input: unknown): Promise<ActionResult<OsView>> {
  return executar('os:atribuir', atribuirResponsavelSchema, input, atribuirResponsavel);
}

export async function editarItensAction(input: unknown): Promise<ActionResult<OsView>> {
  return executar('os:corrigir', editarItensSchema, input, editarItens);
}

export async function ajustarValorAction(input: unknown): Promise<ActionResult<OsView>> {
  return executar('os:ajustar_valor', ajustarValorSchema, input, ajustarValor);
}

export async function listarLavadoresAction(): Promise<ActionResult<Awaited<ReturnType<typeof listarLavadoresParaDirecionar>>>> {
  return executar('os:atribuir', z.undefined(), undefined, (ctx) => listarLavadoresParaDirecionar(ctx));
}

export async function listarFilaAction(): Promise<ActionResult<OsView[]>> {
  return executar('fila:ver', z.undefined(), undefined, (ctx) => listarFila(ctx));
}

export async function listarEntreguesHojeAction(): Promise<ActionResult<OsView[]>> {
  return executar('fila:ver', z.undefined(), undefined, (ctx) => listarEntreguesHoje(ctx));
}

export async function obterOsAction(input: unknown): Promise<ActionResult<OsView | null>> {
  return executar('fila:ver', obterOsSchema, input, (ctx, { osId }) => obterOs(ctx, osId));
}
