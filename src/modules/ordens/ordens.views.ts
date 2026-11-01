import type { Perfil } from '@/lib/auth/types';
import type { StatusOs } from './ordens.rules';

/** OS carregada do banco (o repositório monta); nunca sai para a tela sem passar por toOsView. */
export type OsCompleta = {
  id: string;
  numero: number;
  status: StatusOs;
  observacoes: string | null;
  subtotalCentavos: number;
  descontoCentavos: number;
  acrescimoCentavos: number;
  totalCentavos: number;
  tokenPublico: string;
  urlAcompanhar: string; // montada no servidor com a URL pública; só a visão de gestão a recebe
  lavaJato: string;
  clienteId: string | null;
  veiculo: { placa: string | null; modelo: string | null; cor: string | null };
  cliente: { nome: string; telefone: string | null } | null;
  itens: { id: string; nome: string; valorCentavos: number }[];
  responsavel: { id: string; nomeExibicao: string } | null;
  entradaEm: Date;
  atribuidoEm: Date | null;
  inicioLavagemEm: Date | null;
  prontoEm: Date | null;
  entregueEm: Date | null;
  canceladaEm: Date | null;
};

type Base = Omit<OsCompleta, 'subtotalCentavos' | 'descontoCentavos' | 'acrescimoCentavos' | 'totalCentavos' | 'tokenPublico' | 'urlAcompanhar' | 'lavaJato' | 'clienteId' | 'cliente' | 'itens'>;
/** Sem nenhum valor em R$, sem telefone e sem token público (spec §3). */
export type OsViewLavador = Base & { cliente: { nome: string } | null; itens: { id: string; nome: string }[] };
export type OsViewGestao = OsCompleta;
export type OsView = OsViewGestao | OsViewLavador;

// Allow-list explícita (spec §3): perfil novo não vê valores/token/telefone até ser listado aqui.
const PERFIS_COM_VALORES: ReadonlySet<Perfil> = new Set<Perfil>(['dono', 'gerente', 'recepcao']);
export const veValores = (perfil: Perfil): boolean => PERFIS_COM_VALORES.has(perfil);

// Lista explícita de campos: um campo novo em OsCompleta não vaza para o lavador por engano.
export function toOsView(perfil: Perfil, os: OsCompleta): OsView {
  const base: Base = {
    id: os.id,
    numero: os.numero,
    status: os.status,
    observacoes: os.observacoes,
    veiculo: { placa: os.veiculo.placa, modelo: os.veiculo.modelo, cor: os.veiculo.cor },
    responsavel: os.responsavel && { id: os.responsavel.id, nomeExibicao: os.responsavel.nomeExibicao },
    entradaEm: os.entradaEm,
    atribuidoEm: os.atribuidoEm,
    inicioLavagemEm: os.inicioLavagemEm,
    prontoEm: os.prontoEm,
    entregueEm: os.entregueEm,
    canceladaEm: os.canceladaEm,
  };
  if (!veValores(perfil)) {
    return { ...base, cliente: os.cliente && { nome: os.cliente.nome }, itens: os.itens.map((i) => ({ id: i.id, nome: i.nome })) };
  }
  return {
    ...base,
    subtotalCentavos: os.subtotalCentavos,
    descontoCentavos: os.descontoCentavos,
    acrescimoCentavos: os.acrescimoCentavos,
    totalCentavos: os.totalCentavos,
    tokenPublico: os.tokenPublico,
    urlAcompanhar: os.urlAcompanhar,
    lavaJato: os.lavaJato,
    clienteId: os.clienteId,
    cliente: os.cliente && { nome: os.cliente.nome, telefone: os.cliente.telefone },
    itens: os.itens.map((i) => ({ id: i.id, nome: i.nome, valorCentavos: i.valorCentavos })),
  };
}
