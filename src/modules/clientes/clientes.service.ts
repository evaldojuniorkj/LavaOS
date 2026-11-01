import 'server-only';
import { and, eq } from 'drizzle-orm';
import type { z } from 'zod';
import { assertPermission, can } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { clientes, portes, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { camposCliente, camposVeiculo, type Cliente, type Veiculo } from './clientes.repo';
import type { cadastroRapidoSchema, salvarClienteSchema, salvarTelefoneClienteSchema, salvarVeiculoSchema } from './clientes.schemas';

/** Recusa de regra com mensagem segura para a tela. */
export class ClientesError extends Error {
  constructor(readonly code: 'NAO_ENCONTRADO' | 'PLACA_DUPLICADA' | 'VALIDACAO', message: string, readonly campo?: string) {
    super(message);
    this.name = 'ClientesError';
  }
}
const placaDuplicada = () => new ClientesError('PLACA_DUPLICADA', 'Já existe um veículo com esta placa.');
const violouUnique = (err: unknown) => [err, (err as { cause?: unknown })?.cause].some((e) => (e as { code?: string } | null)?.code === '23505');
const placaObrigatoria = () => new ClientesError('VALIDACAO', 'Informe a placa.', 'placa');
const naoEncontrado = (o: string) => new ClientesError('NAO_ENCONTRADO', `${o} não encontrado.`);

export async function salvarCliente(ctx: TenantContext, input: z.output<typeof salvarClienteSchema>, db: Database = getDatabase()): Promise<Cliente> {
  const { id, ...dados } = input;
  if (!id) return (await db.insert(clientes).values({ ...dados, tenantId: ctx.tenantId }).returning(camposCliente))[0];
  const [c] = await db.update(clientes).set(dados).where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.id, id))).returning(camposCliente);
  if (!c) throw naoEncontrado('Cliente');
  return c;
}

export async function salvarTelefoneCliente(ctx: TenantContext, { clienteId, telefone }: z.output<typeof salvarTelefoneClienteSchema>, db: Database = getDatabase()): Promise<Cliente> {
  const [c] = await db.update(clientes).set({ telefone }).where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.id, clienteId))).returning(camposCliente);
  if (!c) throw naoEncontrado('Cliente');
  return c;
}

export async function salvarVeiculo(ctx: TenantContext, input: z.output<typeof salvarVeiculoSchema>, db: Database = getDatabase()): Promise<Veiculo> {
  const { id, ...dados } = input;
  return gravarVeiculo(db, ctx, id, dados).catch((err) => {
    // corrida entre a checagem e o INSERT/UPDATE: o unique (tenant, placa) responde 23505
    if (violouUnique(err)) throw placaDuplicada();
    throw err;
  });
}

function gravarVeiculo(db: Database, ctx: TenantContext, id: string | undefined, dados: Omit<z.output<typeof salvarVeiculoSchema>, 'id'>): Promise<Veiculo> {
  return db.transaction(async (tx) => {
    // as FKs compostas também impedem vínculo entre tenants; aqui vira "não encontrado" em vez de erro do banco
    const [porte] = await tx.select({ id: portes.id }).from(portes).where(and(eq(portes.tenantId, ctx.tenantId), eq(portes.id, dados.porteId)));
    if (!porte) throw naoEncontrado('Porte');
    if (dados.clienteId) {
      const [c] = await tx.select({ id: clientes.id }).from(clientes).where(and(eq(clientes.tenantId, ctx.tenantId), eq(clientes.id, dados.clienteId)));
      if (!c) throw naoEncontrado('Cliente');
    }
    const { placa } = dados;
    if (placa) {
      const [mesmaPlaca] = await tx.select({ id: veiculos.id }).from(veiculos).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.placa, placa)));
      if (mesmaPlaca && mesmaPlaca.id !== id) throw placaDuplicada();
    } else {
      // sem placa só é aceito ao editar um veículo que já não tem; nunca se apaga placa existente
      if (!id) throw placaObrigatoria();
      // FOR UPDATE: quem grava a placa ao mesmo tempo termina antes, e a leitura já vê a placa (senão o UPDATE abaixo a apagaria)
      const [atual] = await tx.select({ placa: veiculos.placa }).from(veiculos).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.id, id))).for('update');
      if (!atual) throw naoEncontrado('Veículo');
      if (atual.placa) throw placaObrigatoria();
    }
    if (!id) return (await tx.insert(veiculos).values({ ...dados, tenantId: ctx.tenantId }).returning(camposVeiculo))[0];
    const [v] = await tx.update(veiculos).set(dados).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.id, id))).returning(camposVeiculo);
    if (!v) throw naoEncontrado('Veículo');
    return v;
  });
}

/**
 * Cadastro dentro da Nova OS (clientes:gerenciar ou os:abrir). Só CRIA: se a placa já existe, devolve o
 * veículo existente intacto; cliente existente nunca é alterado.
 */
export async function cadastroRapido(
  ctx: TenantContext,
  input: z.output<typeof cadastroRapidoSchema>,
  db: Database = getDatabase(),
): Promise<{ veiculoId: string; clienteId?: string | null }> {
  try {
    assertPermission(ctx, 'clientes:gerenciar');
  } catch {
    assertPermission(ctx, 'os:abrir');
  }
  const r = await db.transaction(async (tx) => {
    const { placa } = input; // sem placa nunca reaproveita veículo: cada cadastro é um veículo novo
    const existente = async () => (placa ? (await tx.select(camposVeiculo).from(veiculos).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.placa, placa))))[0] : undefined);
    const achado = await existente();
    if (achado) return { veiculoId: achado.id, clienteId: achado.clienteId };
    const [porte] = await tx.select({ id: portes.id }).from(portes).where(and(eq(portes.tenantId, ctx.tenantId), eq(portes.id, input.porteId)));
    if (!porte) throw naoEncontrado('Porte');
    // veículo primeiro: se outra requisição criou a mesma placa agora, não sobra cliente órfão
    const [novo] = await tx
      .insert(veiculos)
      .values({ tenantId: ctx.tenantId, placa: placa ?? null, porteId: input.porteId, modelo: input.modelo })
      .onConflictDoNothing()
      .returning({ id: veiculos.id });
    if (!novo) {
      const v = (await existente())!;
      return { veiculoId: v.id, clienteId: v.clienteId };
    }
    if (!input.clienteNome) return { veiculoId: novo.id, clienteId: null };
    const [c] = await tx.insert(clientes).values({ tenantId: ctx.tenantId, nome: input.clienteNome, telefone: input.telefone }).returning({ id: clientes.id });
    await tx.update(veiculos).set({ clienteId: c.id }).where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.id, novo.id)));
    return { veiculoId: novo.id, clienteId: c.id };
  });
  // quem só abre OS (lavador) não recebe id de cliente
  return can(ctx.perfil, 'clientes:gerenciar') ? r : { veiculoId: r.veiculoId };
}
