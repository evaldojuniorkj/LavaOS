import 'server-only';
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { z } from 'zod';
import { assertPermission, can } from '@/lib/auth/permissions';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, osContadores, osEventos, osItens } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { buscarVeiculo, carregarOs, lavadorAtivo, servicosComPreco } from './ordens.repo';
import { calcularTotais, validarSelecaoServicos } from './ordens.rules';
import type { abrirOsSchema } from './ordens.schemas';
import { toOsView, type OsView } from './ordens.views';

/** Recusa de regra com mensagem segura para a tela; `fieldErrors` aponta o campo. */
export class OrdensError extends Error {
  constructor(
    readonly code: 'VALIDACAO',
    message: string,
    readonly fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'OrdensError';
  }
}
const erroCampo = (campo: string, msg: string) => new OrdensError('VALIDACAO', 'Dados inválidos.', { [campo]: [msg] });

/**
 * Uma transação: valida veículo, serviços (preço do banco no porte do veículo) e responsável, depois
 * contador → OS → itens → evento. Falha em qualquer passo desfaz tudo, inclusive o número.
 */
export async function abrirOs(ctx: TenantContext, input: z.output<typeof abrirOsSchema>, db: Database = getDatabase()): Promise<OsView> {
  assertPermission(ctx, 'os:abrir');
  // quem não direciona OS (lavador) só abre para si e não pode indicar ninguém, nem a si mesmo
  const balcao = can(ctx.perfil, 'os:atribuir');
  if (!balcao && input.responsavelId) throw erroCampo('responsavelId', 'O lavador só abre OS para si.');
  return db.transaction(async (tx) => {
    const veiculo = await buscarVeiculo(ctx, input.veiculoId, tx);
    if (!veiculo) throw erroCampo('veiculoId', 'Veículo não encontrado.');
    const lista = await servicosComPreco(ctx, input.servicoIds, veiculo.porteId, tx);
    if (lista.length !== input.servicoIds.length) throw erroCampo('servicoIds', 'Serviço indisponível para o porte do veículo.');
    if (!validarSelecaoServicos(lista).ok) throw erroCampo('servicoIds', 'Escolha ao menos um serviço principal.');
    if (input.responsavelId && !(await lavadorAtivo(ctx, input.responsavelId, tx))) throw erroCampo('responsavelId', 'Escolha um lavador ativo.');
    const responsavelId = balcao ? (input.responsavelId ?? null) : ctx.memberId;

    // upsert trava a linha do contador até o commit: números sem buraco nem repetição
    const [{ numero }] = await tx
      .insert(osContadores)
      .values({ tenantId: ctx.tenantId, ultimo: 1 })
      .onConflictDoUpdate({ target: osContadores.tenantId, set: { ultimo: sql`${osContadores.ultimo} + 1` } })
      .returning({ numero: osContadores.ultimo });
    const totais = calcularTotais({ valoresItens: lista.map((s) => s.valorCentavos), descontoCentavos: 0, acrescimoCentavos: 0 });
    const [os] = await tx
      .insert(ordensServico)
      .values({
        tenantId: ctx.tenantId,
        numero,
        veiculoId: veiculo.id,
        clienteId: veiculo.clienteId,
        responsavelId,
        atribuidoEm: responsavelId ? sql`now()` : null,
        status: 'aguardando',
        ...totais,
        tokenPublico: randomBytes(32).toString('base64url'),
        abertaPor: ctx.memberId,
        observacoes: input.observacoes || null,
      })
      .returning({ id: ordensServico.id });
    await tx.insert(osItens).values(
      lista.map((s) => ({
        tenantId: ctx.tenantId,
        osId: os.id,
        servicoId: s.id,
        porteId: veiculo.porteId,
        nomeServico: s.nome,
        valorCentavos: s.valorCentavos,
        comissaoTipo: s.comissaoTipo,
        comissaoValor: s.comissaoValor,
      })),
    );
    await tx.insert(osEventos).values({ tenantId: ctx.tenantId, osId: os.id, tipo: 'status', para: 'aguardando', membroId: ctx.memberId });
    return toOsView(ctx.perfil, (await carregarOs(ctx, os.id, tx))!);
  });
}
