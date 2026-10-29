import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { clientes, ordensServico, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { normalizarPlaca } from './clientes.rules';

export type Cliente = { id: string; nome: string; telefone: string | null; observacoes: string | null };
export type Veiculo = { id: string; placa: string; modelo: string | null; cor: string | null; porteId: string; clienteId: string | null };

export const camposCliente = { id: clientes.id, nome: clientes.nome, telefone: clientes.telefone, observacoes: clientes.observacoes };
export const camposVeiculo = { id: veiculos.id, placa: veiculos.placa, modelo: veiculos.modelo, cor: veiculos.cor, porteId: veiculos.porteId, clienteId: veiculos.clienteId };

export function listarClientes(ctx: TenantContext, db: Database = getDatabase()): Promise<Cliente[]> {
  return db.select(camposCliente).from(clientes).where(eq(clientes.tenantId, ctx.tenantId)).orderBy(asc(clientes.nome));
}

export function listarVeiculos(ctx: TenantContext, db: Database = getDatabase()): Promise<Veiculo[]> {
  return db.select(camposVeiculo).from(veiculos).where(eq(veiculos.tenantId, ctx.tenantId)).orderBy(asc(veiculos.placa));
}

/** Sem valores em R$ de propósito: serve também ao lavador. */
export async function buscarVeiculoPorPlaca(ctx: TenantContext, placa: string, db: Database = getDatabase()) {
  const p = normalizarPlaca(placa);
  if (!p) return null;
  const [veiculo] = await db.select(camposVeiculo).from(veiculos).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.placa, p)));
  if (!veiculo) return null;
  const [cliente] = veiculo.clienteId
    ? await db.select(camposCliente).from(clientes).where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.id, veiculo.clienteId)))
    : [];
  const ultimasOs = await db
    .select({ id: ordensServico.id, numero: ordensServico.numero, status: ordensServico.status, entradaEm: ordensServico.entradaEm })
    .from(ordensServico)
    .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.veiculoId, veiculo.id)))
    .orderBy(desc(ordensServico.entradaEm))
    .limit(5);
  return { veiculo, cliente: cliente ?? null, ultimasOs };
}
