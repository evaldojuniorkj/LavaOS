import type { Perfil, Permissao, TenantContext } from './types';

const TODOS = ['dono', 'gerente', 'recepcao', 'lavador'] as const;
const GESTAO = ['dono', 'gerente'] as const;
const FRENTE = ['dono', 'gerente', 'recepcao'] as const;

// Matriz da spec §3 (permissão -> perfis que a têm).
const MATRIZ: Record<Permissao, readonly Perfil[]> = {
  'fila:ver': TODOS,
  'os:abrir': TODOS,
  'os:assumir': ['dono', 'gerente', 'lavador'],
  'os:atribuir': FRENTE,
  'os:avancar': TODOS,
  'os:corrigir': FRENTE,
  'os:entregar': FRENTE,
  'os:cancelar': FRENTE,
  'os:reabrir': GESTAO,
  'os:ajustar_valor': GESTAO,
  'clientes:gerenciar': FRENTE,
  'agenda:gerenciar': FRENTE,
  'caixa:operar': FRENTE,
  'caixa:reabrir': GESTAO,
  'caixa:estornar': GESTAO,
  'despesas:gerenciar': GESTAO,
  'relatorios:ver': GESTAO,
  'comissoes:gerenciar': GESTAO,
  'fidelidade:consultar': FRENTE,
  'fidelidade:resgatar': FRENTE,
  'fidelidade:configurar': GESTAO,
  'catalogo:gerenciar': GESTAO,
  'equipe:gerenciar': GESTAO,
  'equipe:gerenciar_lideranca': ['dono'],
  'painel:ver': FRENTE,
};

/** Operações com ação de domínio existente; fases posteriores acrescentam aqui. */
const IMPLANTADAS: ReadonlySet<Permissao> = new Set<Permissao>([
  'equipe:gerenciar',
  'equipe:gerenciar_lideranca',
  'fila:ver',
  'os:abrir',
  'os:assumir',
  'os:atribuir',
  'os:avancar',
  'os:corrigir',
  'os:entregar',
  'os:cancelar',
  'os:reabrir',
  'os:ajustar_valor',
  'clientes:gerenciar',
  'caixa:operar',
  'caixa:reabrir',
  'caixa:estornar',
  'despesas:gerenciar',
  'comissoes:gerenciar',
  'catalogo:gerenciar',
  'painel:ver',
]);

export function can(perfil: Perfil, permissao: Permissao): boolean {
  // hasOwn: entrada desconhecida (ex.: 'toString') nega em vez de herdar do protótipo
  return Object.hasOwn(MATRIZ, permissao) && MATRIZ[permissao].includes(perfil);
}

export function assertPermission(ctx: TenantContext, permissao: Permissao): void {
  if (!IMPLANTADAS.has(permissao) || !can(ctx.perfil, permissao)) throw new AcessoNegadoError();
}

export class AcessoNegadoError extends Error {
  /** Permissão que faltou, quando quem negou sabe qual é (só para o log). */
  constructor(readonly permissao?: Permissao) {
    super('acesso negado'); // sem nomear o recurso
    this.name = 'AcessoNegadoError';
  }
}
