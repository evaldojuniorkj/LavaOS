'use client';

import type { Painel } from '@/modules/painel/painel.repo';

// Provisório: a Task 4 troca por o painel de verdade.
export function PainelView({ inicial }: { inicial: Painel }) {
  const c = inicial.contagem;
  return (
    <ul>
      <li>Aguardando: {c.aguardando}</li>
      <li>Em lavagem: {c.emLavagem}</li>
      <li>Pronto: {c.pronto}</li>
      <li>Entregues hoje: {c.entreguesHoje}</li>
    </ul>
  );
}
