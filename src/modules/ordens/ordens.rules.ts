import { can } from '@/lib/auth/permissions';
import type { Perfil, Permissao } from '@/lib/auth/types';

/** Erros após os quais a UI deve recarregar a fila (a OS mudou sob os pés do usuário). */
export const ERROS_RECARREGAR_FILA = ['CONFLITO_OS', 'NAO_E_RESPONSAVEL', 'OS_ENCERRADA', 'NAO_QUITADA'] as const; // NAO_QUITADA: tela velha mostrava Entregar sem a OS estar paga

export type StatusOs = 'aguardando' | 'em_lavagem' | 'pronto' | 'entregue' | 'cancelada';

/** Total = subtotal − desconto + acréscimo, em centavos inteiros, nunca negativo. */
export function calcularTotais(i: { valoresItens: number[]; descontoCentavos: number; acrescimoCentavos: number }) {
  // Guarda de erro de programação: quem chama valida na borda (Zod).
  if (![...i.valoresItens, i.descontoCentavos, i.acrescimoCentavos].every((v) => Number.isSafeInteger(v) && v >= 0)) throw new RangeError('valor inválido');
  const subtotalCentavos = i.valoresItens.reduce((a, v) => a + v, 0);
  return { subtotalCentavos, totalCentavos: Math.max(0, subtotalCentavos - i.descontoCentavos + i.acrescimoCentavos) };
}

type Erro = 'transicao_invalida' | 'sem_permissao' | 'sem_responsavel' | 'nao_e_responsavel' | 'motivo_obrigatorio';
type Regra = { permissao: Permissao; limpaResponsavel?: boolean; exigeResponsavel?: boolean; soResponsavel?: boolean; motivo?: boolean };

// Tabela de transições (spec §5.2). Nada sai de cancelada; entregue só volta para pronto (Reabrir, Fase 4).
const TRANSICOES: Partial<Record<StatusOs, Partial<Record<StatusOs, Regra>>>> = {
  aguardando: {
    em_lavagem: { permissao: 'os:assumir' }, // ou os:atribuir quando o balcão designa o responsável
    cancelada: { permissao: 'os:cancelar', motivo: true },
  },
  em_lavagem: {
    pronto: { permissao: 'os:avancar', exigeResponsavel: true, soResponsavel: true },
    aguardando: { permissao: 'os:corrigir', limpaResponsavel: true },
    cancelada: { permissao: 'os:cancelar', motivo: true },
  },
  pronto: {
    em_lavagem: { permissao: 'os:corrigir' },
    entregue: { permissao: 'os:entregar', exigeResponsavel: true },
    cancelada: { permissao: 'os:cancelar', motivo: true },
  },
  entregue: {
    pronto: { permissao: 'os:reabrir', motivo: true },
  },
};

export function decidirTransicao(i: {
  de: StatusOs;
  para: StatusOs;
  perfil: Perfil;
  temResponsavel: boolean;
  ehResponsavel: boolean;
  /** true: o balcão designa o responsável (os:atribuir); false: o ator pega para si (os:assumir). Só vale para aguardando→em_lavagem. */
  responsavelExplicito: boolean;
  motivo?: string;
}): { ok: true; permissao: Permissao; limpaResponsavel: boolean } | { ok: false; erro: Erro } {
  const destinos = Object.hasOwn(TRANSICOES, i.de) ? TRANSICOES[i.de] : undefined;
  const regra = destinos && Object.hasOwn(destinos, i.para) ? destinos[i.para] : undefined;
  if (!regra) return { ok: false, erro: 'transicao_invalida' };
  const inicio = i.de === 'aguardando' && i.para === 'em_lavagem';
  const permissao = inicio && i.responsavelExplicito ? 'os:atribuir' : regra.permissao;
  if (!can(i.perfil, permissao)) return { ok: false, erro: 'sem_permissao' };
  if (regra.motivo && !i.motivo?.trim()) return { ok: false, erro: 'motivo_obrigatorio' };
  if ((regra.exigeResponsavel || (inicio && i.responsavelExplicito)) && !i.temResponsavel) return { ok: false, erro: 'sem_responsavel' };
  if (inicio && !i.responsavelExplicito && i.temResponsavel && !i.ehResponsavel) return { ok: false, erro: 'nao_e_responsavel' };
  if (regra.soResponsavel && i.perfil === 'lavador' && !i.ehResponsavel) return { ok: false, erro: 'nao_e_responsavel' };
  return { ok: true, permissao, limpaResponsavel: regra.limpaResponsavel ?? false };
}

export function validarSelecaoServicos(servicos: { id: string; adicional: boolean }[]): { ok: true } | { ok: false; erro: 'sem_servico_principal' } {
  return servicos.some((s) => !s.adicional) ? { ok: true } : { ok: false, erro: 'sem_servico_principal' };
}

/** Orientação apenas: o livre há mais tempo (desempate por membroId); nada é bloqueado. */
export function sugerirLavadorLivre(lavadores: { membroId: string; emLavagem: number; livreDesde: Date }[]): string | null {
  const livres = lavadores.filter((l) => l.emLavagem === 0 && !Number.isNaN(l.livreDesde.getTime()));
  livres.sort((a, b) => a.livreDesde.getTime() - b.livreDesde.getTime() || (a.membroId < b.membroId ? -1 : 1));
  return livres[0]?.membroId ?? null;
}
