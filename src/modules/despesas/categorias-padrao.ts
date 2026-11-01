/**
 * Categorias criadas em todo lava jato novo (primeiro acesso, seed-dev e fixtures; a migração 0005 repete os nomes).
 * Sem imports: o seed-dev e o global-setup E2E importam este arquivo direto, sem bundler.
 * "Comissões" é de sistema: a Fase 5 lança nela e ela não é renomeada nem desativada.
 */
export const CATEGORIAS_PADRAO = [
  { nome: 'Produtos', sistema: false },
  { nome: 'Água e luz', sistema: false },
  { nome: 'Aluguel', sistema: false },
  { nome: 'Vales', sistema: false },
  { nome: 'Outros', sistema: false },
  { nome: 'Comissões', sistema: true },
] as const;
