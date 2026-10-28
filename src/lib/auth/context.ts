import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '@/lib/db/client';
import { membros, session } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { AcessoNegadoError, assertPermission } from './permissions';
import { getAuth } from './server';
import type { Permissao, TenantContext } from './types';

/** Forma mínima da sessão que o guard exige (o reader real é o getSession do Better Auth). */
export type SessionClaims = {
  session: { id: string; userId: string; expiresAt: Date; activeOrganizationId?: string | null };
};
export type SessionReader = (headers: Headers) => Promise<SessionClaims | null>;

export function createTenantGuards(deps: { readSession: SessionReader; database?: Database; now?: () => Date }) {
  const now = deps.now ?? (() => new Date());

  // Único ponto que emite TenantContext; tudo vem do banco, a sessão lida só aponta qual linha conferir.
  async function requireTenantContext(headers: Headers): Promise<TenantContext> {
    const claims = (await deps.readSession(headers))?.session;
    // guid: mesma forma que o Postgres aceita; id malformado vira negação, não erro 22P02
    if (!claims || !z.guid().safeParse(claims.id).success) throw new AcessoNegadoError();
    const db = deps.database ?? getDatabase();
    // seam (tarefa 5): a checagem de pinCredentialVersion entra aqui, junto com a linha da sessão.
    const [row] = await db
      .select({ userId: session.userId, expiresAt: session.expiresAt, org: session.activeOrganizationId, memberId: membros.id, perfil: membros.perfil })
      .from(session)
      .innerJoin(membros, and(eq(membros.userId, session.userId), eq(membros.tenantId, session.activeOrganizationId)))
      .where(and(eq(session.id, claims.id), eq(membros.ativo, true)));
    if (!row || row.userId !== claims.userId || row.org !== (claims.activeOrganizationId ?? null) || row.expiresAt <= now()) {
      throw new AcessoNegadoError();
    }
    return { tenantId: row.org!, userId: row.userId, memberId: row.memberId, perfil: row.perfil, sessionId: claims.id } as TenantContext;
  }

  async function requirePermission(headers: Headers, permissao: Permissao): Promise<TenantContext> {
    let ctx: TenantContext | undefined;
    try {
      ctx = await requireTenantContext(headers);
      assertPermission(ctx, permissao);
      return ctx;
    } catch (err) {
      // spec §7: tentativa registrada só com ids; nunca headers, cookie, token, PIN, senha ou corpo
      if (err instanceof AcessoNegadoError) {
        console.warn('[auth] acesso negado', { permissao, tenantId: ctx?.tenantId, memberId: ctx?.memberId, perfil: ctx?.perfil });
      }
      throw err;
    }
  }

  return { requireTenantContext, requirePermission };
}

/** Guards do app, lendo a sessão real do Better Auth; o guard revalida tudo no banco. */
export const { requireTenantContext, requirePermission } = createTenantGuards({
  readSession: (headers) => getAuth().api.getSession({ headers }),
});
