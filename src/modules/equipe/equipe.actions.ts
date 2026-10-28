'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import type { MemberSummary } from './equipe.repo';
import { createMemberSchema, memberIdSchema, resetPinSchema } from './equipe.schemas';
import { createMember, deactivateMember, EquipeError, resetPin } from './equipe.service';

export type ActionResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string; fieldErrors?: Record<string, string[]> };

/** Permissão base, depois validação estrita, depois o serviço (que revalida tudo travado). Nada é gravado antes disso. */
async function executar<S extends z.ZodType>(
  schema: S,
  input: unknown,
  fn: (ctx: TenantContext, data: z.output<S>) => Promise<MemberSummary | null>,
): Promise<ActionResult<MemberSummary | null>> {
  let ctx: TenantContext | undefined;
  try {
    ctx = await requirePermission(await headers(), 'equipe:gerenciar');
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) {
      // negação do serviço (liderança, alvo que o ator não gere); as do guard já foram registradas por requirePermission
      if (ctx) console.warn('[auth] acesso negado', { permissao: 'equipe:gerenciar', tenantId: ctx.tenantId, memberId: ctx.memberId, perfil: ctx.perfil });
      return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' };
    }
    if (err instanceof EquipeError) return { ok: false, code: err.code, message: err.message };
    // só o nome: a mensagem do driver traz os parâmetros da query (hash)
    console.error('[equipe] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function createMemberAction(input: unknown): Promise<ActionResult<MemberSummary | null>> {
  return executar(createMemberSchema, input, (ctx, data) => createMember(ctx, data));
}

export async function deactivateMemberAction(input: unknown): Promise<ActionResult<MemberSummary | null>> {
  return executar(memberIdSchema, input, async (ctx, { memberId }) => (await deactivateMember(ctx, memberId), null));
}

export async function resetPinAction(input: unknown): Promise<ActionResult<MemberSummary | null>> {
  return executar(resetPinSchema, input, async (ctx, { memberId, pin }) => (await resetPin(ctx, memberId, pin), null));
}
