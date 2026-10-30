import 'server-only';
import { and, asc, desc, eq } from 'drizzle-orm';
import { can } from '@/lib/auth/permissions';
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

/**
 * Sem valores em R$ de propósito. O formato depende do perfil do contexto: quem não tem
 * clientes:gerenciar (lavador) recebe só o nome do cliente, sem ids de cliente, telefone nem observações.
 */
export async function buscarVeiculoPorPlaca(ctx: TenantContext, placa: string, db: Database = getDatabase()) {
  const p = normalizarPlaca(placa);
  if (!p) return null;
  const [veiculo] = await db.select(camposVeiculo).from(veiculos).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.placa, p)));
  if (!veiculo) return null;
  const completo = can(ctx.perfil, 'clientes:gerenciar');
  const [cliente] = veiculo.clienteId
    ? await db
        .select(completo ? camposCliente : { nome: clientes.nome })
        .from(clientes)
        .where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.id, veiculo.clienteId)))
    : [];
  const ultimasOs = await db
    .select({ id: ordensServico.id, numero: ordensServico.numero, status: ordensServico.status, entradaEm: ordensServico.entradaEm })
    .from(ordensServico)
    .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.veiculoId, veiculo.id)))
    .orderBy(desc(ordensServico.entradaEm))
    .limit(5);
  return {
    // lista explícita: campo novo em camposVeiculo não vaza para o lavador por engano
    veiculo: completo ? veiculo : { id: veiculo.id, placa: veiculo.placa, modelo: veiculo.modelo, cor: veiculo.cor, porteId: veiculo.porteId },
    cliente: (cliente ?? null) as Cliente | Pick<Cliente, 'nome'> | null,
    ultimasOs,
  };
}
