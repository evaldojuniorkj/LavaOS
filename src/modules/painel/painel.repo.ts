import 'server-only';
import { and, eq, gte, inArray, or } from 'drizzle-orm';
import type { TenantContext } from '@/lib/auth/types';
import { getDatabase } from '@/lib/db/client';
import { ordensServico, veiculos } from '@/lib/db/schema';
import type { Database } from '@/lib/db/types';
import { listarLavadoresParaDirecionar } from '@/modules/ordens/ordens.repo';
import { estaAtrasada, inicioDoDia, minutosEntre, tempoMedioLavagem } from './painel.rules';

export type Painel = {
  atualizadoEm: Date;
  contagem: { aguardando: number; emLavagem: number; pronto: number; entreguesHoje: number };
  tempoMedioLavagemMin: number | null;
  atrasadas: { id: string; numero: number; placa: string | null; status: 'aguardando' | 'em_lavagem'; minutos: number }[];
  lavadores: { membroId: string; nome: string; livre: boolean; osEmLavagem: number[] }[];
};

/** Só contagens e tempos: nenhum valor, token ou telefone sai daqui (o painel é de leitura para a gestão). */
export async function carregarPainel(ctx: TenantContext, agora = new Date(), db: Pick<Database, 'select'> = getDatabase()): Promise<Painel> {
  const hoje = inicioDoDia(agora);
  // shortcut: agrega em memória; um dia de lava jato cabe folgado, migrar para count/avg em SQL se passar de alguns milhares de OSs/dia.
  const [oss, lavadores] = await Promise.all([
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
      atrasadas.push({ id: o.id, numero: o.numero, placa: o.placa, status: o.status, minutos: minutosEntre(desde, agora) });
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
  };
}
