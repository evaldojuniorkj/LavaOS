import type { Perfil } from '@/lib/db/schema';

export type { Perfil };
export { PERFIS } from '@/lib/db/schema';

/** Exatamente as permissões da spec §3; `painel:ver` entra na fase do painel. */
export const PERMISSOES = [
  'fila:ver', 'os:abrir', 'os:assumir', 'os:atribuir', 'os:avancar', 'os:corrigir', 'os:entregar', 'os:cancelar',
  'os:reabrir', 'os:ajustar_valor', 'clientes:gerenciar', 'agenda:gerenciar', 'caixa:operar', 'caixa:reabrir',
  'caixa:estornar', 'despesas:gerenciar', 'relatorios:ver', 'comissoes:gerenciar', 'fidelidade:consultar',
  'fidelidade:resgatar', 'fidelidade:configurar', 'catalogo:gerenciar', 'equipe:gerenciar', 'equipe:gerenciar_lideranca',
] as const;
export type Permissao = (typeof PERMISSOES)[number];

export interface TenantScope {
  readonly tenantId: string;
}

declare const emitidoPeloGuard: unique symbol;

/** Só `createTenantGuards` (context.ts) emite este tipo; a marca impede contexto forjado em tempo de compilação. */
export interface TenantContext extends TenantScope {
  readonly userId: string;
  readonly memberId: string;
  readonly perfil: Perfil;
  readonly sessionId: string;
  readonly [emitidoPeloGuard]: true;
}
