'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { abrirOsSchema } from './ordens.schemas';
import { abrirOs, OrdensError } from './ordens.service';
import type { OsView } from './ordens.views';

/** Permissão, validação estrita e serviço; a resposta ao lavador já sai sem valores (toOsView). */
export async function abrirOsAction(input: unknown): Promise<ActionResult<OsView>> {
  try {
    const ctx = await requirePermission(await headers(), 'os:abrir');
    const parsed = abrirOsSchema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await abrirOs(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    if (err instanceof OrdensError) return { ok: false, code: err.code, message: err.message, ...(err.fieldErrors && { fieldErrors: err.fieldErrors }) };
    console.error('[ordens] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}
