import 'server-only';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '@/lib/db/client';
import type { Database } from '@/lib/db/types';
import { membros } from '@/lib/db/schema';
import type { Perfil, TenantContext } from '@/lib/auth/types';

export type MemberSummary = { id: string; nomeExibicao: string; perfil: Perfil; ativo: boolean };

// Allowlist: nunca selecionar hash, PIN, token ou valores financeiros.
const campos = { id: membros.id, nomeExibicao: membros.nomeExibicao, perfil: membros.perfil, ativo: membros.ativo };

export function listMembers(ctx: TenantContext, db: Database = getDatabase()): Promise<MemberSummary[]> {
  return db.select(campos).from(membros).where(eq(membros.tenantId, ctx.tenantId)).orderBy(membros.createdAt);
}

export async function findMember(ctx: TenantContext, memberId: string, db: Database = getDatabase()): Promise<MemberSummary | null> {
  if (!z.guid().safeParse(memberId).success) return null; // evita erro 22P02 do Postgres
  const [row] = await db.select(campos).from(membros).where(and(eq(membros.tenantId, ctx.tenantId), eq(membros.id, memberId)));
  return row ?? null;
}
