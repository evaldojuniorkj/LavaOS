import 'server-only';
import { and, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, pagamentos, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { caixaDoDia } from '@/modules/caixa/caixa.repo';
import { FORMAS, type Forma } from '@/modules/caixa/caixa.rules';
import { listarLavadoresParaDirecionar } from '@/modules/ordens/ordens.repo';
import { estaAtrasada, inicioDoDia, minutosEntre, tempoMedioLavagem } from './painel.rules';

export type Painel = {
  atualizadoEm: Date;
  contagem: { aguardando: number; emLavagem: number; pronto: number; entreguesHoje: number };
  tempoMedioLavagemMin: number | null;
  atrasadas: { id: string; numero: number; placa: string | null; modelo: string | null; status: 'aguardando' | 'em_lavagem'; minutos: number }[];
  lavadores: { membroId: string; nome: string; livre: boolean; osEmLavagem: number[] }[];
  caixa: { status: 'aberto' | 'fechado' | 'sem_caixa'; recebidoPorForma: Record<Forma, number>; recebidoTotal: number };
};

type Leitor = Pick<Database, 'select'>;

/** Recebido no caixa de hoje (sem estornados), somado no banco por forma. */
async function caixaDeHoje(ctx: TenantContext, agora: Date, db: Leitor): Promise<Painel['caixa']> {
  const c = await caixaDoDia(ctx, agora, db);
  const recebidoPorForma = Object.fromEntries(FORMAS.map((f) => [f, 0])) as Record<Forma, number>;
  if (c) {
    const somas = await db
      .select({ forma: pagamentos.forma, total: sql<number>`sum(${pagamentos.valorCentavos})::int` })
      .from(pagamentos)
      .where(and(eq(pagamentos.tenantId, ctx.tenantId), eq(pagamentos.caixaId, c.id), isNull(pagamentos.estornadoEm)))
      .groupBy(pagamentos.forma);
    for (const s of somas) recebidoPorForma[s.forma] = s.total;
  }
  return { status: c?.status ?? 'sem_caixa', recebidoPorForma, recebidoTotal: FORMAS.reduce((t, f) => t + recebidoPorForma[f], 0) };
}

/** Contagens, tempos e o recebido do dia: nenhum token ou telefone sai daqui (o lavador nem acessa o painel). */
export async function carregarPainel(ctx: TenantContext, agora = new Date(), db: Leitor = getDatabase()): Promise<Painel> {
  const hoje = inicioDoDia(agora);
  // shortcut: agrega em memória; um dia de lava jato cabe folgado, migrar para count/avg em SQL se passar de alguns milhares de OSs/dia.
  const [oss, lavadores, caixa] = await Promise.all([
    db
      .select({
        id: ordensServico.id,
        numero: ordensServico.numero,
        status: ordensServico.status,
        responsavelId: ordensServico.responsavelId,
        entradaEm: ordensServico.entradaEm,
        inicioLavagemEm: ordensServico.inicioLavagemEm,
        prontoEm: ordensServico.prontoEm,
        entregueEm: ordensServico.entregueEm,
        placa: veiculos.placa,
        modelo: veiculos.modelo,
      })
      .from(ordensServico)
      .innerJoin(veiculos, and(eq(veiculos.tenantId, ordensServico.tenantId), eq(veiculos.id, ordensServico.veiculoId)))
      .where(
        and(
          eq(ordensServico.tenantId, ctx.tenantId),
          or(inArray(ordensServico.status, ['aguardando', 'em_lavagem', 'pronto']), gte(ordensServico.prontoEm, hoje), gte(ordensServico.entregueEm, hoje)),
        ),
      ),
    listarLavadoresParaDirecionar(ctx, db),
    caixaDeHoje(ctx, agora, db),
  ]);

  const contagem = { aguardando: 0, emLavagem: 0, pronto: 0, entreguesHoje: 0 };
  const amostras: { inicioLavagemEm: Date; prontoEm: Date }[] = [];
  const atrasadas: Painel['atrasadas'] = [];
  const porLavador = new Map<string, number[]>();
  for (const o of oss) {
    if (o.status === 'aguardando') contagem.aguardando++;
    else if (o.status === 'em_lavagem') {
      contagem.emLavagem++;
      if (o.responsavelId) porLavador.set(o.responsavelId, [...(porLavador.get(o.responsavelId) ?? []), o.numero]);
    } else if (o.status === 'pronto') contagem.pronto++;
    else if (o.status === 'entregue' && o.entregueEm && o.entregueEm >= hoje) contagem.entreguesHoje++;

    if ((o.status === 'pronto' || o.status === 'entregue') && o.inicioLavagemEm && o.prontoEm && o.prontoEm >= hoje) amostras.push({ inicioLavagemEm: o.inicioLavagemEm, prontoEm: o.prontoEm });
    if (o.status !== 'aguardando' && o.status !== 'em_lavagem') continue;
    if (estaAtrasada(o, agora)) {
      const desde = o.status === 'em_lavagem' ? (o.inicioLavagemEm ?? o.entradaEm) : o.entradaEm;
      atrasadas.push({ id: o.id, numero: o.numero, placa: o.placa, modelo: o.modelo, status: o.status, minutos: minutosEntre(desde, agora) });
    }
  }

  return {
    atualizadoEm: agora,
    contagem,
    tempoMedioLavagemMin: tempoMedioLavagem(amostras),
    atrasadas: atrasadas.sort((a, b) => b.minutos - a.minutos),
    lavadores: lavadores
      .map((l) => ({ membroId: l.membroId, nome: l.nome, livre: l.livre, osEmLavagem: (porLavador.get(l.membroId) ?? []).sort((a, b) => a - b) }))
      .sort((a, b) => Number(b.livre) - Number(a.livre)),
    caixa,
  };
}
