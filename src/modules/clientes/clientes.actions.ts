'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { requirePermission } from '@/lib/auth/context';
import { AcessoNegadoError } from '@/lib/auth/permissions';
import type { Permissao, TenantContext } from '@/lib/auth/types';
import type { ActionResult } from '@/modules/catalogo/catalogo.actions';
import { buscarVeiculoPorPlaca, type Cliente, type Veiculo } from './clientes.repo';
import { cadastroRapidoSchema, salvarClienteSchema, salvarTelefoneClienteSchema, salvarVeiculoSchema } from './clientes.schemas';
import { cadastroRapido, ClientesError, salvarCliente, salvarTelefoneCliente, salvarVeiculo } from './clientes.service';

/** Permissão base, depois validação estrita, depois o serviço. Nada é gravado antes disso. */
async function executar<S extends z.ZodType, T>(permissao: Permissao, schema: S, input: unknown, fn: (ctx: TenantContext, data: z.output<S>) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const ctx = await requirePermission(await headers(), permissao);
    const parsed = schema.safeParse(input, { error: z.locales.pt().localeError });
    if (!parsed.success) {
      return { ok: false, code: 'VALIDACAO', message: 'Dados inválidos.', fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
    }
    return { ok: true, data: await fn(ctx, parsed.data) };
  } catch (err) {
    if (err instanceof AcessoNegadoError) return { ok: false, code: 'ACESSO_NEGADO', message: 'acesso negado' }; // já registrado por requirePermission
    if (err instanceof ClientesError) return { ok: false, code: err.code, message: err.message };
    console.error('[clientes] falha inesperada', { erro: err instanceof Error ? err.name : typeof err });
    return { ok: false, code: 'ERRO_INTERNO', message: 'Não foi possível concluir. Tente novamente.' };
  }
}

export async function salvarClienteAction(input: unknown): Promise<ActionResult<Cliente>> {
  return executar('clientes:gerenciar', salvarClienteSchema, input, salvarCliente);
}

export async function salvarTelefoneClienteAction(input: unknown): Promise<ActionResult<Cliente>> {
  return executar('clientes:gerenciar', salvarTelefoneClienteSchema, input, salvarTelefoneCliente);
}

export async function salvarVeiculoAction(input: unknown): Promise<ActionResult<Veiculo>> {
  return executar('clientes:gerenciar', salvarVeiculoSchema, input, salvarVeiculo);
}

export async function cadastroRapidoAction(input: unknown) {
  return executar('os:abrir', cadastroRapidoSchema, input, cadastroRapido);
}

/** Consulta da Nova OS: o formato do cliente é decidido pelo perfil dentro do repositório (lavador só vê o nome). */
export async function buscarPorPlacaAction(input: unknown) {
  return executar('os:abrir', z.strictObject({ placa: z.string().max(20) }), input, (ctx, { placa }) => buscarVeiculoPorPlaca(ctx, placa));
}
