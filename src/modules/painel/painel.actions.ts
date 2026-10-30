'use server';

import { headers } from 'next/headers';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { carregarPainel, type Painel } from './painel.repo';

export async function carregarPainelAction(): Promise<ActionResult<Painel>> {
  try {
    const ctx = await requirePermission(await headers(), 'painel:ver');
    return { ok: true, data: await carregarPainel(ctx) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    console.error('[painel] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}
