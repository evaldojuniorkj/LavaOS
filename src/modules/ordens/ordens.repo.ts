import 'server-only';
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { clientes, membros, ordensServico, osItens, precos, servicos, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { sugerirLavadorLivre } from './ordens.rules';
import type { OsCompleta } from './ordens.views';

/** Database ou transação: só leitura. */
type Leitor = Pick<Database, 'select'>;

export async function buscarVeiculo(ctx: TenantContext, id: string, db: Leitor = getDatabase()) {
  const [v] = await db
    .select({ id: veiculos.id, porteId: veiculos.porteId, clienteId: veiculos.clienteId })
    .from(veiculos)
    .where(and(eq(veiculos.tenantId, ctx.tenantId), eq(veiculos.id, id)));
  return v ?? null;
}

/** Só serviços ativos do tenant com preço para o porte; quem faltar na resposta está indisponível. */
export function servicosComPreco(ctx: TenantContext, ids: string[], porteId: string, db: Leitor = getDatabase()) {
  return db
    .select({
      id: servicos.id,
      nome: servicos.nome,
      adicional: servicos.adicional,
      comissaoTipo: servicos.comissaoTipo,
      comissaoValor: servicos.comissaoValor,
      valorCentavos: precos.valorCentavos,
    })
    .from(servicos)
    .innerJoin(precos, and(eq(precos.tenantId, servicos.tenantId), eq(precos.servicoId, servicos.id), eq(precos.porteId, porteId)))
    .where(and(eq(servicos.tenantId, ctx.tenantId), eq(servicos.ativo, true), inArray(servicos.id, ids)));
}

/** FOR SHARE: dentro de uma transação, uma desativação concorrente espera o commit em vez de passar despercebida. */
export async function lavadorAtivo(ctx: TenantContext, id: string, db: Leitor = getDatabase()): Promise<boolean> {
  const [m] = await db
    .select({ id: membros.id })
    .from(membros)
    .where(and(eq(membros.tenantId, ctx.tenantId), eq(membros.id, id), eq(membros.perfil, 'lavador'), eq(membros.ativo, true)))
    .for('share');
  return !!m;
}

/** Lavadores ativos: livre = nenhuma OS em lavagem; sugerido = o livre há mais tempo (só orientação). */
export async function listarLavadoresParaDirecionar(ctx: TenantContext, db: Leitor = getDatabase()) {
  const rows = await db
    .select({
      membroId: membros.id,
      nome: membros.nomeExibicao,
      cadastroEm: membros.createdAt,
      emLavagem: sql<number>`count(*) filter (where ${ordensServico.status} = 'em_lavagem')`.mapWith(Number),
      ultimoPronto: max(ordensServico.prontoEm),
    })
    .from(membros)
    .leftJoin(ordensServico, and(eq(ordensServico.tenantId, membros.tenantId), eq(ordensServico.responsavelId, membros.id)))
    .where(and(eq(membros.tenantId, ctx.tenantId), eq(membros.perfil, 'lavador'), eq(membros.ativo, true)))
    .groupBy(membros.id)
    .orderBy(asc(membros.nomeExibicao));
  const sugerido = sugerirLavadorLivre(rows.map((r) => ({ membroId: r.membroId, emLavagem: r.emLavagem, livreDesde: r.ultimoPronto ?? r.cadastroEm })));
  return rows.map((r) => ({ membroId: r.membroId, nome: r.nome, livre: r.emLavagem === 0, sugerido: r.membroId === sugerido }));
}

export async function carregarOs(ctx: TenantContext, id: string, db: Leitor = getDatabase()): Promise<OsCompleta | null> {
  const [row] = await db
    .select({
      os: ordensServico,
      veiculo: { placa: veiculos.placa, modelo: veiculos.modelo, cor: veiculos.cor },
      cliente: { nome: clientes.nome, telefone: clientes.telefone },
      responsavel: { id: membros.id, nomeExibicao: membros.nomeExibicao },
    })
    .from(ordensServico)
    .innerJoin(veiculos, and(eq(veiculos.tenantId, ordensServico.tenantId), eq(veiculos.id, ordensServico.veiculoId)))
    .leftJoin(clientes, and(eq(clientes.tenantId, ordensServico.tenantId), eq(clientes.id, ordensServico.clienteId)))
    .leftJoin(membros, and(eq(membros.tenantId, ordensServico.tenantId), eq(membros.id, ordensServico.responsavelId)))
    .where(and(eq(ordensServico.tenantId, ctx.tenantId), eq(ordensServico.id, id)));
  if (!row) return null;
  const itens = await db
    .select({ id: osItens.id, nome: osItens.nomeServico, valorCentavos: osItens.valorCentavos })
    .from(osItens)
    .where(and(eq(osItens.tenantId, ctx.tenantId), eq(osItens.osId, id)))
    .orderBy(asc(osItens.createdAt), asc(osItens.id));
  const { os } = row;
  return {
    id: os.id,
    numero: os.numero,
    status: os.status,
    observacoes: os.observacoes,
    subtotalCentavos: os.subtotalCentavos,
    descontoCentavos: os.descontoCentavos,
    acrescimoCentavos: os.acrescimoCentavos,
    totalCentavos: os.totalCentavos,
    tokenPublico: os.tokenPublico,
    veiculo: row.veiculo,
    cliente: row.cliente,
    itens,
    responsavel: row.responsavel,
    entradaEm: os.entradaEm,
    atribuidoEm: os.atribuidoEm,
    inicioLavagemEm: os.inicioLavagemEm,
    prontoEm: os.prontoEm,
    entregueEm: os.entregueEm,
    canceladaEm: os.canceladaEm,
  };
}

/** Itens da OS com o flag `adicional` do serviço de origem (para revalidar a seleção após editar). */
export function itensDaOs(ctx: TenantContext, osId: string, db: Leitor = getDatabase()) {
  return db
    .select({ id: osItens.id, servicoId: osItens.servicoId, nome: osItens.nomeServico, valorCentavos: osItens.valorCentavos, comissaoTipo: osItens.comissaoTipo, comissaoValor: osItens.comissaoValor, adicional: servicos.adicional })
    .from(osItens)
    .innerJoin(servicos, and(eq(servicos.tenantId, osItens.tenantId), eq(servicos.id, osItens.servicoId)))
    .where(and(eq(osItens.tenantId, ctx.tenantId), eq(osItens.osId, osId)));
}
