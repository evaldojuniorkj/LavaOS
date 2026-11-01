import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { portes, precos, servicos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { camposPorte, camposServico, type Porte, type ServicoComPrecos } from './catalogo.repo';
import type { definirPrecoSchema, salvarPorteSchema, salvarServicoSchema } from './catalogo.schemas';

/** Recusa de regra com mensagem segura para a tela. */
export class CatalogoError extends Error {
  constructor(readonly code: 'NAO_ENCONTRADO', message: string) {
    super(message);
    this.name = 'CatalogoError';
  }
}
const naoEncontrado = (o: string) => new CatalogoError('NAO_ENCONTRADO', `${o} não encontrado.`);

export async function salvarPorte(ctx: TenantContext, input: z.output<typeof salvarPorteSchema>, db: Database = getDatabase()): Promise<Porte> {
  const { id, ...dados } = input;
  if (!id) return (await db.insert(portes).values({ ...dados, tenantId: ctx.tenantId }).returning(camposPorte))[0];
  const [p] = await db.update(portes).set(dados).where(and(eq(portes.tenantId, ctx.tenantId), eq(portes.id, id))).returning(camposPorte);
  if (!p) throw naoEncontrado('Porte');
  return p;
}

export async function salvarServico(ctx: TenantContext, input: z.output<typeof salvarServicoSchema>, db: Database = getDatabase()): Promise<Omit<ServicoComPrecos, 'precos'>> {
  const { id, ...dados } = input;
  if (!id) return (await db.insert(servicos).values({ ...dados, tenantId: ctx.tenantId }).returning(camposServico))[0];
  const [s] = await db.update(servicos).set(dados).where(and(eq(servicos.tenantId, ctx.tenantId), eq(servicos.id, id))).returning(camposServico);
  if (!s) throw naoEncontrado('Serviço');
  return s;
}

export async function definirPreco(ctx: TenantContext, input: z.output<typeof definirPrecoSchema>, db: Database = getDatabase()): Promise<{ servicoId: string; porteId: string; valorCentavos: number }> {
  return db.transaction(async (tx) => {
    // as FKs compostas também impedem preço entre tenants; aqui vira "não encontrado" em vez de erro do banco
    const [s] = await tx.select({ id: servicos.id }).from(servicos).where(and(eq(servicos.tenantId, ctx.tenantId), eq(servicos.id, input.servicoId)));
    const [p] = await tx.select({ id: portes.id }).from(portes).where(and(eq(portes.tenantId, ctx.tenantId), eq(portes.id, input.porteId)));
    if (!s) throw naoEncontrado('Serviço');
    if (!p) throw naoEncontrado('Porte');
    await tx
      .insert(precos)
      .values({ ...input, tenantId: ctx.tenantId })
      .onConflictDoUpdate({ target: [precos.servicoId, precos.porteId], set: { valorCentavos: input.valorCentavos } });
    return input;
  });
}
