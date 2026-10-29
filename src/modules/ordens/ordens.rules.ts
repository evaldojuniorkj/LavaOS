import { can } from '@/lib/auth/permissions';
import type { Perfil, Permissao } from '@/lib/auth/types';

export type StatusOs = 'aguardando' | 'em_lavagem' | 'pronto' | 'entregue' | 'cancelada';

/** Total = subtotal − desconto + acréscimo, em centavos inteiros, nunca negativo. */
export function calcularTotais(i: { valoresItens: number[]; descontoCentavos: number; acrescimoCentavos: number }) {
  const subtotalCentavos = i.valoresItens.reduce((a, v) => a + v, 0);
  return { subtotalCentavos, totalCentavos: Math.max(0, subtotalCentavos - i.descontoCentavos + i.acrescimoCentavos) };
}

type Erro = 'transicao_invalida' | 'sem_permissao' | 'sem_responsavel' | 'nao_e_responsavel' | 'motivo_obrigatorio';
type Regra = { permissao: Permissao; limpaResponsavel?: boolean; exigeResponsavel?: boolean; soResponsavel?: boolean; motivo?: boolean };

// Tabela de transições da Fase 1 (spec §5.2). Nada sai de entregue/cancelada.
const TRANSICOES: Partial<Record<StatusOs, Partial<Record<StatusOs, Regra>>>> = {
  aguardando: {
    em_lavagem: { permissao: 'os:assumir', soResponsavel: true },
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
};

export function decidirTransicao(i: {
  de: StatusOs;
  para: StatusOs;
  perfil: Perfil;
  temResponsavel: boolean;
  ehResponsavel: boolean;
  motivo?: string;
}): { ok: true; permissao: Permissao; limpaResponsavel: boolean } | { ok: false; erro: Erro } {
  const regra = TRANSICOES[i.de]?.[i.para];
  if (!regra) return { ok: false, erro: 'transicao_invalida' };
  // Balcão: quem não pode assumir (recepção) inicia a lavagem por atribuição.
  const permissao = i.de === 'aguardando' && i.para === 'em_lavagem' && !can(i.perfil, 'os:assumir') ? 'os:atribuir' : regra.permissao;
  if (!can(i.perfil, permissao)) return { ok: false, erro: 'sem_permissao' };
  if (regra.motivo && !i.motivo?.trim()) return { ok: false, erro: 'motivo_obrigatorio' };
  if (regra.exigeResponsavel && !i.temResponsavel) return { ok: false, erro: 'sem_responsavel' };
  if (regra.soResponsavel && i.perfil === 'lavador' && i.temResponsavel && !i.ehResponsavel) return { ok: false, erro: 'nao_e_responsavel' };
  return { ok: true, permissao, limpaResponsavel: regra.limpaResponsavel ?? false };
}

export function validarSelecaoServicos(servicos: { id: string; adicional: boolean }[]): { ok: true } | { ok: false; erro: 'sem_servico_principal' } {
  return servicos.some((s) => !s.adicional) ? { ok: true } : { ok: false, erro: 'sem_servico_principal' };
}

/** Orientação apenas: o livre há mais tempo (desempate por membroId); nada é bloqueado. */
export function sugerirLavadorLivre(lavadores: { membroId: string; emLavagem: number; livreDesde: Date }[]): string | null {
  const livres = lavadores.filter((l) => l.emLavagem === 0);
  livres.sort((a, b) => a.livreDesde.getTime() - b.livreDesde.getTime() || (a.membroId < b.membroId ? -1 : 1));
  return livres[0]?.membroId ?? null;
}
