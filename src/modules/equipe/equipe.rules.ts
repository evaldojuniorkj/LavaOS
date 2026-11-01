import type { Perfil } from '@/lib/auth/types';

const GERIDOS_PELO_GERENTE: readonly Perfil[] = ['recepcao', 'lavador'];

/** Alterar, desativar ou resetar PIN: dono gere qualquer perfil; gerente só recepção/lavador. */
export function canManageTarget(ator: Perfil, alvo: Perfil): boolean {
  return ator === 'dono' || (ator === 'gerente' && GERIDOS_PELO_GERENTE.includes(alvo));
}

/** Nunca deixa o tenant sem dono ativo. A tarefa 6 revalida isto dentro da transação. */
export function canDeactivateMember(ator: Perfil, alvo: Perfil, donosAtivos: number): boolean {
  return canManageTarget(ator, alvo) && !(alvo === 'dono' && donosAtivos <= 1);
}
