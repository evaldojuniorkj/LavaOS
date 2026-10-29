import 'server-only';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { getDatabase } from '@/lib/db/client';
import type { Database } from '@/lib/db/types';
import { portes, precos, servicos } from '@/lib/db/schema';
import type { TenantContext } from '@/lib/auth/types';

export type Porte = { id: string; nome: string; ordem: number; ativo: boolean };
export type ServicoComPrecos = {
  id: string;
  nome: string;
  descricao: string | null;
  duracaoEstimadaMin: number | null;
  ativo: boolean;
  adicional: boolean;
  comissaoTipo: 'percentual' | 'fixo';
  comissaoValor: number;
  precos: { porteId: string; valorCentavos: number }[];
};

export const camposPorte = { id: portes.id, nome: portes.nome, ordem: portes.ordem, ativo: portes.ativo };
export const camposServico = {
  id: servicos.id,
  nome: servicos.nome,
  descricao: servicos.descricao,
  duracaoEstimadaMin: servicos.duracaoEstimadaMin,
  ativo: servicos.ativo,
  adicional: servicos.adicional,
  comissaoTipo: servicos.comissaoTipo,
  comissaoValor: servicos.comissaoValor,
};

export function listarPortes(ctx: TenantContext, db: Database = getDatabase()): Promise<Porte[]> {
  return db.select(camposPorte).from(portes).where(eq(portes.tenantId, ctx.tenantId)).orderBy(asc(portes.ordem), asc(portes.createdAt));
}

export async function listarServicosComPrecos(ctx: TenantContext, db: Database = getDatabase()): Promise<ServicoComPrecos[]> {
  const [lista, valores] = await Promise.all([
    db.select(camposServico).from(servicos).where(eq(servicos.tenantId, ctx.tenantId)).orderBy(asc(servicos.nome)),
    db.select({ servicoId: precos.servicoId, porteId: precos.porteId, valorCentavos: precos.valorCentavos }).from(precos).where(eq(precos.tenantId, ctx.tenantId)),
  ]);
  return lista.map((s) => ({ ...s, precos: valores.filter((p) => p.servicoId === s.id).map(({ porteId, valorCentavos }) => ({ porteId, valorCentavos })) }));
}

/** Só serviços ativos com preço para o porte; é o que a Nova OS oferece. */
export async function listarServicosDisponiveis(
  ctx: TenantContext,
  porteId: string,
  db: Database = getDatabase(),
): Promise<{ id: string; nome: string; valorCentavos: number; adicional: boolean }[]> {
  if (!z.guid().safeParse(porteId).success) return []; // evita erro 22P02 do Postgres
  return db
    .select({ id: servicos.id, nome: servicos.nome, valorCentavos: precos.valorCentavos, adicional: servicos.adicional })
    .from(servicos)
    .innerJoin(precos, and(eq(precos.tenantId, servicos.tenantId), eq(precos.servicoId, servicos.id)))
    .where(and(eq(servicos.tenantId, ctx.tenantId), eq(servicos.ativo, true), eq(precos.porteId, porteId)))
    .orderBy(asc(servicos.nome));
}
