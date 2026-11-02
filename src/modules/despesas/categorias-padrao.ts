/**
 * Categorias criadas em todo lava jato novo (primeiro acesso, seed-dev e fixtures; a migração 0005 repete os nomes).
 * Sem imports: o seed-dev e o global-setup E2E importam este arquivo direto, sem bundler.
 * "Vales" e "Comissões" são de sistema: a Fase 5 lança nelas e elas não são renomeadas nem desativadas.
 */
export const CATEGORIAS_PADRAO = [
  { nome: 'Produtos', sistema: false },
  { nome: 'Água e luz', sistema: false },
  { nome: 'Aluguel', sistema: false },
  { nome: 'Vales', sistema: true },
  { nome: 'Outros', sistema: false },
  { nome: 'Comissões', sistema: true },
] as const;
