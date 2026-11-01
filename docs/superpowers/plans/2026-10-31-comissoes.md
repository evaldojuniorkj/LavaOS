# Fase 5 — Comissões e vales: Implementation Plan

> **For agentic workers:** execute task by task (one subagent per task, review after each). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o acerto semanal de cada lavador sai do sistema: comissões geradas na entrega − vales (e dívida anterior) = valor a pagar. Substitui a aba VALES e a conta feita à mão.

**Architecture:** três tabelas (`comissoes`, `vales`, `acertos_comissao`) numa migração; regra pura de rateio e cálculo (`comissoes.rules.ts`); a entrega e a reabertura da OS geram e removem comissões na mesma transação; o vale é uma despesa da categoria "Vales" ligada ao lavador; o acerto vincula comissões e vales e lança como despesa "Comissões" só o que foi pago. Tela `/comissoes`.

**Tech Stack:** o da Fase 4. Nenhuma dependência nova.

**Estado:** não iniciado. Branch `fase-5-comissoes`, a partir de `fase-4-dinheiro` (PR #2).

**Spec:** [Especificação do MVP](../specs/2026-09-30-lavaos-mvp-design.md) §4 Comissões, §5.2 (reabrir), §5.5. [Roteiro](2026-10-31-roteiro.md), Fase 5 e decisões de 2026-10-31.

## Global Constraints

- Centavos inteiros. Percentual em pontos-base (10000 = 100 %); arredondamento **meio-para-cima** em centavos.
- **Base do item** (§5.5, sem fidelidade): desconto e acréscimo da OS rateados proporcionalmente aos valores dos itens; a sobra de centavos do rateio vai para o item de maior valor (empate: o primeiro na ordem dos itens); **Σ bases = total da OS**. Item de valor zero não recebe rateio; se todos forem zero, todas as bases são zero.
- **Comissão do item:** percentual = `round_half_up(base × pb / 10000)`; fixo = o valor contratado (mesmo com base zero). Uma linha de `comissoes` por item, toda para o **responsável da OS** no momento da entrega (sem divisão).
- Geração **na transição para `entregue`**, na mesma transação. `unique (tenant_id, os_item_id)`: entregar de novo nunca duplica.
- **Reabrir** (`entregue → pronto`): apaga as comissões **pendentes** da OS na mesma transação; se alguma já estiver num acerto, a reabertura é **recusada** ("Comissão já paga no acerto de DD/MM"). `comissoes` é dado derivado: `lavaos_app` tem DELETE nela; `vales` e `acertos_comissao` ficam sem DELETE (como as financeiras).
- **Vale** = adiantamento a um membro: grava `vales` e, na mesma transação, uma despesa paga da categoria **"Vales"** (`lancarDespesa` da Fase 4, com `doCaixa` opcional). Cancelar o vale (só pendente) cancela a despesa junto.
- **Acerto** (por membro, até uma data): `comissoes` = Σ pendentes com OS entregue até a data; `vales` = Σ vales pendentes até a data + **saldo devedor do acerto anterior** do membro; `pago = max(0, comissoes − vales)`; `saldo_devedor = max(0, vales − comissoes)` ("o lavador fica devendo", carregado para o próximo acerto). Vincula comissões e vales; se `pago > 0`, lança despesa paga "Comissões" (com `doCaixa` opcional) e grava `despesa_id`. Vale já é despesa quando é dado: **o acerto nunca lança o vale de novo**.
- Lock: acerto trava a linha do membro (`FOR UPDATE` em `membros`) para serializar acertos e vales do mesmo membro; entrega e reabertura seguem OS → (membro só para leitura). `lock_timeout` 5 s com mensagem própria.
- Permissão: `comissoes:gerenciar` (dono, gerente) — entra em `IMPLANTADAS`. O **lavador nunca vê R$** (decisão de 2026-10-31): nada de comissão na visão dele.
- Membro desativado com pendência continua aparecendo no acerto.

## Review Focus

- 33,33 % sobre itens de R$ 50,00, R$ 30,00 e R$ 20,00 com desconto de R$ 7,00: bases somam R$ 93,00 e cada comissão arredonda meio-para-cima (Task 2).
- Entregar, reabrir e entregar de novo: uma comissão por item, sem duplicar (Task 3).
- Acerto pago e gerente tenta reabrir a OS: recusado (Task 3).
- Vale de R$ 300 com R$ 200 de comissão: acerto paga R$ 0 e deixa R$ 100 de saldo devedor; o próximo acerto desconta os R$ 100 (Task 4).
- Despesas do mês somam vales + pagamentos de acerto = comissões geradas (quando não há saldo devedor) — nada em dobro (Task 4).
- Dois acertos simultâneos do mesmo membro: um passa, o outro não acha pendências (Task 4).
- Resposta e SSE do lavador continuam sem R$ (Task 6).

---

### Task 1: Schema, migração e permissão

**Files:** `src/lib/db/schema/comissoes.ts` (novo), `schema/index.ts`, migração `pnpm db:generate --name comissoes` (+ `REVOKE DELETE` de `vales` e `acertos_comissao` como na 0005), `src/lib/auth/permissions.ts`. **Test:** `tests/integration/schema-comissoes.test.ts`, `tests/unit/permissions.test.ts`.

**Tabelas** (padrão das financeiras: `id`, `tenant_id`, `unique (tenant_id, id)`, FKs compostas, timestamps):
- `comissoes`: `os_id`, `os_item_id` (unique por tenant), `membro_id`, `base_centavos`, `valor_centavos` (≥ 0), `acerto_id` (nulo = pendente), `gerada_em`. Índices `(tenant_id, membro_id, acerto_id)`, `(tenant_id, os_id)`.
- `vales`: `membro_id`, `valor_centavos` (> 0), `dado_em`, `dado_por`, `despesa_id` (not null), `acerto_id`, `cancelado_em`, `cancelado_por`, `motivo_cancelamento` (check três-juntos). Índice `(tenant_id, membro_id, acerto_id)`.
- `acertos_comissao`: `membro_id`, `periodo_inicio` (date), `periodo_fim` (date), `comissoes_centavos`, `vales_centavos`, `saldo_anterior_centavos`, `pago_centavos`, `saldo_devedor_centavos` (todos ≥ 0), `despesa_id` (nulo quando `pago = 0`), `pago_em`, `pago_por`. Check: `pago = greatest(0, comissoes − vales − saldo_anterior)` e `saldo_devedor = greatest(0, vales + saldo_anterior − comissoes)`.

- [x] Testes que falham (unique de `os_item_id`; vale sem despesa recusado; check do acerto; `lavaos_app` sem DELETE em `vales`/`acertos_comissao` e com DELETE em `comissoes`; `comissoes:gerenciar` só dono/gerente e implantada) → implementar → `pnpm db:migrate`, `pnpm test`, `pnpm typecheck` → commit `feat(comissoes): tabelas de comissões, vales e acertos`.

### Task 2: Regras puras

**Files:** `src/modules/comissoes/comissoes.rules.ts`. **Test:** `tests/unit/comissoes.rules.test.ts`.

**Produces:** `basesDosItens(itens: number[], desconto: number, acrescimo: number): number[]` (Σ = max(0, Σitens − desconto + acréscimo), sobra no maior); `comissaoDoItem(base: number, tipo: 'percentual' | 'fixo', valor: number): number`; `calcularAcerto({ comissoes: number[], vales: number[], saldoAnterior: number }): { comissoesCentavos, valesCentavos, saldoAnteriorCentavos, pagoCentavos, saldoDevedorCentavos }`.

- [x] Testes que falham: o caso dos 33,33 % da Review Focus; desconto maior que o subtotal (todas as bases zero); acréscimo; um item só; itens de valor zero; empate do maior; meio centavo arredonda para cima (ex.: base 150, 3333 pb → 50); fixo com base zero; acerto com vale maior, igual e menor, com saldo anterior; propriedade: para 200 casos aleatórios com semente fixa, Σ bases = total → implementar → commit `feat(comissoes): rateio, comissão por item e acerto`.

### Task 3: Geração na entrega e reabertura

**Files:** `src/modules/comissoes/comissoes.service.ts` (`gerarComissoes(tx, ctx, osId)`, `removerComissoesPendentes(tx, ctx, osId)`), `src/modules/ordens/ordens.service.ts` (`transitarOs` chama os dois). **Test:** `tests/integration/comissoes-geracao.test.ts`, `ordens-transicoes.test.ts`.

- [x] Testes que falham: entregar gera uma comissão por item para o responsável, com bases e valores das regras; OS de total zero com item fixo gera o fixo; reabrir apaga as pendentes; entregar de novo regera sem duplicar; reabrir com comissão em acerto (semeado direto) é recusado e nada muda; responsável trocado entre reabertura e nova entrega recebe a nova comissão → implementar → commit `feat(comissoes): geração na entrega e remoção na reabertura`.

### Task 4: Vales e acerto

**Files:** `src/modules/comissoes/{comissoes.repo,comissoes.service,comissoes.schemas,comissoes.actions}.ts`. **Test:** `tests/integration/comissoes-acerto.test.ts`.

**Produces:** `lancarVale(ctx, { membroId, valorCentavos, doCaixa? })` (usa `lancarDespesa` na categoria "Vales" dentro da mesma transação — exporte uma variante que recebe `tx` se preciso); `cancelarVale(ctx, { valeId, motivo })` (só pendente; cancela a despesa); `previaAcerto(ctx, { membroId, ate })`; `pagarAcerto(ctx, { membroId, ate, doCaixa? })`; repo `pendentesPorMembro(ctx, ate)` (todos os membros com comissão, vale ou saldo devedor, inclusive desativados), `acertosDoMembro(ctx, membroId)`, `detalheAcerto(ctx, acertoId)` (OS, itens, comissão; vales). Actions com `comissoes:gerenciar`.

- [x] Testes que falham: os cenários de vale maior/igual/menor da Review Focus; saldo devedor carregado no acerto seguinte; vale com `doCaixa` reduz o esperado do caixa; cancelar vale pendente cancela a despesa, vale em acerto não cancela; despesa "Comissões" só quando `pago > 0`; soma de despesas = comissões geradas; acerto concorrente do mesmo membro; comissão de OS entregue depois de `ate` fica para o próximo; outro tenant não aparece; recepção negada → implementar → commit `feat(comissoes): vales e acerto com saldo devedor`.

### Task 5: Tela `/comissoes`

**Files:** `src/app/(interno)/comissoes/page.tsx`, `src/components/comissoes-view.tsx`, menu (`app-shell`, `layout`, ícone), `ROTAS_INTERNAS`, `matcher`.

- [ ] Por membro: comissões pendentes, vales pendentes, saldo devedor anterior, **a pagar** ou **fica devendo**; "Lançar vale" (valor, "pago com dinheiro do caixa" quando o caixa de hoje está aberto); "Fazer acerto até [data, padrão hoje]" com a prévia antes de confirmar; histórico de acertos; "Imprimir" abre o detalhe do acerto com CSS de impressão (`@media print`, sem menu), para o lavador conferir. Reaproveita `Modal`/`Motivo`, `formatarReais`, `decimalParaCentesimos`. Lint, typecheck, test → commit `feat(comissoes): tela de comissões, vales e acerto`.

### Task 6: E2E e fechamento da fase

- [ ] `tests/e2e/comissoes.spec.ts`: duas OSs entregues para o mesmo lavador (com caixa via helpers de `tests/e2e/dinheiro.ts`), um vale com dinheiro do caixa, prévia e acerto pagando a diferença, segundo cenário com vale maior deixando dívida e o próximo acerto descontando; gerente tenta reabrir OS já acertada → mensagem; recepção em `/comissoes` → acesso negado; 360 px sem rolagem. `operacao-lavador.spec.ts`: lavador continua sem R$ e sem `comissao` nas respostas.
- [ ] `pnpm verify:operacao`; README (Fase 5), CODEBASE_MAP, spec (§4 vales, §9 concluída), roteiro, Estado deste plano → commit `docs: fecha a fase 5`.

## Fora desta fase (decidido)

- Lavador vendo a própria comissão: não (2026-10-31).
- Regra de comissão por lavador: não existe (spec §4); só por serviço.
- Fidelidade (brinde e comissão do brinde): Fase 9.
