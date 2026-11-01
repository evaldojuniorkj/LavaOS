# Fase 1 — Operação: revisão final da branch

Base `2f40fcd` (topo de fase-0-fundacao) → `e3e5866`, 31 commits. Revisor final: lentes code-reviewer + ponytail-audit. Só leitura; nenhum subagente; nenhuma suíte rodada (confiei nos números do implementador: 475 unit+integração, 124 E2E, `verify:operacao` verde 2× e num clone limpo).

Li em uma passada: migration `0003_operacao.sql`; todos os módulos `catalogo`, `clientes`, `ordens` (rules, repo, service, views, actions, schemas, publico.repo); `lib/realtime/*`, `lib/rate-limit.ts`, `lib/auth/ip.ts`, `proxy.ts`, `route-policy.ts`, permissions; as rotas `/api/eventos`, `/api/acompanhar/[token]/eventos`, `/api/teste/assinantes`; as páginas internas, do lavador, pública, login e primeiro acesso; `use-eventos.ts`, `ao-vivo.tsx`, trechos de `fila-board.tsx` e `login-form.tsx`; o diff de `equipe.*`, `server.ts`, `env.ts`, `package.json`, `playwright.config.ts`, `verify-operacao.ts`, CI e `.env.example`; os nomes dos testes de integração; o ledger e a triagem da Fundação. Não li linha a linha os specs E2E, os formulários de cliente (catálogo/clientes/nova OS/WhatsApp) nem os componentes do PWA além do tratamento de erro.

## Veredito

**READY AFTER FIXES.** Não achei nada Critical. As falhas do Review Focus estão fechadas no servidor e cada uma tem um teste que prova. Faltam três correções baratas antes do merge: (1) trocar uma palavra no lock de membro do `equipe.service`, o que fecha o deadlock conhecido; (2) fazer os dois itens herdados da Fundação que o ledger prometeu para esta fase e que sumiram sem registro; (3) rodar o CI de verdade antes de integrar na `main`.

## Pontos fortes

- **Dinheiro nunca chega ao lavador por construção, não por disciplina.** `toOsView` usa allow-list de perfis (`PERFIS_COM_VALORES`) e de campos (`ordens.views.ts:37-71`). O repo nunca devolve `OsCompleta` para fora. O NOTIFY leva só `{tenantId, osId, tipo}` (`publicar.ts:7`). O SSE público manda só `{tipo}`. Os históricos de `os_eventos` com R$ nunca são lidos no `src`. O redirect do lavador está dentro de `fila/page.tsx` e `nova-os/page.tsx`, antes de qualquer leitura, porque layout e página renderizam em paralelo; esse foi um achado real da T13 e tem scan de HTML+RSC.
- **Transições corretas sob concorrência.** `travarOs` (FOR UPDATE) decide sobre o estado travado, o `UPDATE … WHERE status = esperado` serve de segunda guarda, os eventos e o publish entram na mesma transação, e Pegar repetido é idempotente. Testes: `ordens-concorrencia.test.ts:44` (Pegar×Pegar) e `:60` (Pegar×Cancelar), `ordens-transicoes.test.ts:114`.
- **Numeração sem buraco nem duplicata.** O upsert do contador trava a linha até o commit e o rollback desfaz o número (`ordens-abrir.test.ts:101`, com 20 concorrentes).
- **Link público bem fechado.** 256 bits de token; formato inválido não chega ao banco; null idêntico para malformado, inexistente e expirado; HTML byte a byte igual; Referrer-Policy/noindex no proxy e na rota; limite de novas conexões e de streams abertos por IP; vaga liberada mesmo quando a montagem lança erro; heartbeat que revalida o token e fecha após os 7 dias. `buscarOsPublica`/`localizarOsPublica` são a única leitura sem tenant, e o tenant sai da própria OS.
- **Assistente de primeiro acesso.** Código de instalação comparado com `timingSafeEqual` sobre sha256; advisory lock com a checagem depois do lock, tudo na mesma transação; sem env, 404; serviços de exemplo inativos e sem preço (evita OS a R$ 0).
- **Tempo real.** NOTIFY dentro da transação (rollback não publica: `realtime.test.ts:177`). `resync` a cada LISTEN, inclusive o primeiro. Stream do membro revogado fecha no heartbeat (`:211`). A sonda do próprio `/api/eventos` substitui o get-session e assim contorna o problema do PIN velho.
- O teto `PRECO_MAXIMO_CENTAVOS` + `cabeNoBanco` cobre preço, desconto, acréscimo e soma, e o Zod strict em toda borda.
- Higiene: nenhuma dependência nova, nada versionado que não devesse (`.superpowers/`, `.env*`, `test-results/` ignorados; só os 3 PNGs do PWA em `public/`), matriz com as mesmas 24 permissões, `IMPLANTADAS` com exatamente as 13 usadas (`os:reabrir` fica de fora, como a Fase 1 exige), e um teste de allow-list exata de tabelas que prova que não há tabela de fase futura.

## Integração entre tarefas: travas

Inventário das travas: `abrirOs` (FOR SHARE em `membros` do indicado → upsert em `os_contadores` → INSERTs com KEY SHARE de FK em `lava_jatos`, `veiculos`, `clientes`, `membros`(aberta_por, responsável)); `transitarOs`/`atribuirResponsavel`/`editarItens`/`ajustarValor` (OS FOR UPDATE → FOR SHARE no lavador → INSERT em `os_eventos`, KEY SHARE no ator); `equipe.service` (tenant FOR NO KEY UPDATE → ator **FOR UPDATE** → alvo **FOR UPDATE** → credencial FOR UPDATE); `pin.repo` (credencial FOR UPDATE OF credenciais_lavador); assistente (advisory lock, sem tenant ainda).

Único ciclo que achei, e já conhecido: o mesmo gerente G desativa o lavador L (trava G FOR UPDATE e espera L) enquanto atribui L numa OS, ou abre uma OS direcionada a L (segura L FOR SHARE e precisa de KEY SHARE em G para o FK `os_eventos.membro_id`/`aberta_por`). O Postgres detecta o deadlock em ~1 s, o pedido devolve ERRO_INTERNO e nada se corrompe.

Sobre a proposta `travarAtor` com FOR NO KEY UPDATE: **está correta, mas faça no `linhaMembro` inteiro** (ator e alvo). Motivos:
- KEY SHARE (as checagens de FK) só conflita com FOR UPDATE.
- NO KEY UPDATE conflita consigo mesmo e com FOR SHARE. Então as mutações de equipe continuam serializadas entre si, e a corrida desativar×atribuir continua protegida pelo FOR SHARE de `lavadorAtivo`.
- `membros.id` nunca muda, então FOR UPDATE não traz nenhuma proteção a mais. Hoje ele só bloqueia inserts que referenciam o membro, e esses inserts passam logo depois do commit de qualquer forma.

Resultado: uma palavra fecha o deadlock e também o Minor "linhaMembro FOR UPDATE" da T1. Teste: estender `schema-operacao.test.ts:108` (o mesmo padrão de barreira) para "atribuir L enquanto o mesmo ator desativa L" terminar sem 40P01.

## Achados

### Critical
Nenhum.

### Important

**I1. Deadlock equipe×ordens (lock de membro FOR UPDATE).** `src/modules/equipe/equipe.service.ts:49`. Cenário: o gerente, com duas abas, desativa o Lucas e ao mesmo tempo direciona (ou abre) uma OS para o Lucas; uma das duas falha com "Não foi possível concluir". Raro, sem corrupção. Classifico como Important só porque a correção é uma palavra e a Fase 2 (caixa) vai pendurar mais inserts com FK em `membros`. Correção: `.for('no key update')` + o teste acima.

**I2. Itens herdados da Fundação, prometidos para esta fase, caíram sem registro.** O ledger (linha 4) lista quatro. Dois foram feitos (tenant NO KEY UPDATE, e o get-session substituído pela sonda). Dois não:
- `findCredential` (`src/lib/auth/pin.repo.ts:57`) e `PRODUCT_NAME` (`src/lib/env.ts:4`) continuam exportados e sem uso.
- O log de negação ainda grava sempre `permissao: 'equipe:gerenciar'` (`src/modules/equipe/equipe.actions.ts:31`), mesmo quando a negação é de `equipe:gerenciar_lideranca`. Quem audita o log de um gerente que tentou promover alguém a dono vê a permissão errada.

Correção: apagar os dois exports e registrar a permissão real. São minutos de trabalho; está em Important porque o processo prometeu e não rastreou.

**I3. CI nunca rodou no GitHub.** O `.github/workflows/quality.yml` aponta para `verify:operacao`, mas nunca rodou. A triagem da Fundação já tinha marcado isso como pré-merge, e continua pendente nas duas fases. Exige push, que só o usuário autoriza. Antes de integrar na `main`: push da branch e um run verde (ou registrar a decisão de aceitar sem CI).

### Minor

- **M1. `cadastroRapido` ainda devolve `clienteId` ao lavador.** `src/modules/clientes/clientes.service.ts:81,92,97`. O fix `01301e0` tirou o id da busca por placa, mas o cadastro rápido com placa existente devolve `{veiculoId, clienteId}` para quem só tem `os:abrir`. É um id opaco, sem valor nem telefone, mas é a mesma classe de vazamento que acabou de ser corrigida. Correção: omitir `clienteId` quando `!can(perfil,'clientes:gerenciar')`, ou devolver só `veiculoId`, já que a Nova OS do lavador não precisa do cliente.
- **M2. `abrirOs` fica fora de `emTransacao`.** `ordens.service.ts:55`. Sem `lock_timeout`, um FOR SHARE ou o contador preso espera indefinidamente, e 55P03/40P01 viram ERRO_INTERNO em vez de "tente novamente". Uma linha: usar `emTransacao`.
- **M3. Pegar não confere se o próprio lavador continua ativo.** `transitarOs`, `ordens.service.ts:192`. O lavador toca "Pegar" no mesmo segundo em que é desativado: a OS fica em lavagem com um responsável inativo e o balcão precisa reatribuir. Correção: `lavadorAtivo(ctx, ctx.memberId, tx)` quando o perfil é lavador e não é explícito.
- **M4. `inicio_lavagem_em` preservado por `coalesce` depois de em_lavagem→aguardando.** `ordens.service.ts:199`. Uma OS iniciada por engano, corrigida e iniciada de novo horas depois fica com o tempo de lavagem inflado. Hoje não afeta nada; afeta o "tempo médio de lavagem" do painel → Fase 2 decide.
- **M5. `/clientes` fora do matcher do proxy e de `ROTAS_INTERNAS`.** `proxy.ts:26`, `route-policy.ts:26`. Quem abre `/clientes` sem cookie vê "Sua sessão terminou" em vez de um login limpo, e após o login cai em `/inicio` em vez de voltar. `/configuracoes/catalogo` também não volta após o login. Só UX; a autorização real está na página.
- **M6. Limites do link público por IP são baixos para CGNAT/Wi-Fi do lava jato.** `api/acompanhar/[token]/eventos/route.ts:11-12`, `proxy.ts:7`. Com 5 streams e 30 páginas/min por IP, o 6º cliente na mesma rede vê "Reconectando…" e recarrega a cada 30 s; cada recarga gasta mais da cota da página, até cair no 429 em texto puro. Ajustar os números na Fase 8, com o tráfego real.
- **M7. `Alerta`/`useEnvio` exportados de `catalogo-form.tsx`, hoje com 5 consumidores.** Entre eles `lavador/cartao-os.tsx`. A condição do deferral da T3 ("mover no 3º consumidor") já disparou. Também estão duplicados: `ActionResult` (em `catalogo.actions.ts:12` e `equipe.actions.ts:12`), três `executar` quase iguais e dois `emTransacao`. É limpeza de Fase 2, sem bug.
- **M8. A conexão LISTEN não tem keepalive TCP.** `listener.ts:20`. Uma queda silenciosa (NAT/firewall) nunca dispara `error`, e a fila para de atualizar sem "Reconectando…". No mesmo host Docker é improvável → Fase 8: `keepAlive: true` no `Client`.
- **M9. `os_contadores` foge da convenção "toda tabela: id, created_at, updated_at".** A PK é `tenant_id`. O desvio é justificado (é um contador), mas não ficou registrado no plano. Aceito.
- **M10. Fundação, itens FASE-1 não rastreados no ledger:** assert "dono de A não seleciona B" no guard (T4), foco após desativar membro (T7), replay do lavador no "criar" (T8). Nenhum foi feito → Fase 2, junto com a próxima mexida em equipe.

## Review Focus de ponta a ponta

| Modo de falha | Onde fecha | Teste | Caminho descoberto |
|---|---|---|---|
| R$/token/telefone/comissão ao lavador | `toOsView` + allow-lists; actions retornam a view; NOTIFY só com ids; redirect na página antes dos dados; páginas negam antes de ler | `ordens.views.test.ts`, `ordens-abrir.test.ts:159`, `realtime.test.ts:134`, `ordens-edicao.test.ts:150`, E2E do lavador (HTML+RSC de /lavador, /fila, /nova-os, rede) | `cadastroRapido` devolve clienteId (M1, sem R$); `observacoes` em texto livre vai ao lavador (conteúdo digitado pelo usuário, ver "Declinei") |
| Pegar×Pegar, Pegar×Cancelar | `travarOs` + `UPDATE … status = esperado` | `ordens-concorrencia.test.ts:44,60`; E2E da corrida | — |
| editarItens/ajustarValor × transição | mesmo `travarOs` | sem teste dedicado (aceito na T7) | — |
| atribuir × desativar | FOR SHARE em `lavadorAtivo` | sem teste; deadlock com o mesmo ator (I1) | I1 |
| Isolamento de tenant | todo repo/service filtra `ctx.tenantId`; FKs compostas; joins com tenant | `ordens-transicoes.test.ts:205`, `ordens-abrir.test.ts:252`, `schema-operacao.test.ts:57,87`, `realtime.test.ts:192`, `publico.test.ts:130` | varri todas as queries novas: só `porToken` não tem tenant (é a pública); `nomeLavaJato` e o join com `lava_jatos` filtram pelo id do tenant |
| Link público | ver Pontos fortes | `publico.test.ts:87-223`, E2E HTML idêntico | limites para CGNAT (M6); nginx loga o token (Fase 8) |
| Tempo real | publish na transação, resync, heartbeat | `realtime.test.ts:124-241`, E2E de fechar o contexto | LISTEN sem keepalive (M8) |
| Primeiro acesso | código + advisory lock + checagem sob lock | `primeiro-acesso.test.ts:89-143` | X-Real-IP ausente = DoS (Fase 8) |
| Estouro de int4 | teto + `cabeNoBanco` | `ordens-edicao.test.ts:164` | — |
| Numeração | contador travado | `ordens-abrir.test.ts:101` | — |

## Spec drift

- Nada de fase futura: sem `agendamento_id`, `exige_quitacao`, caixa, cálculo de comissão (o item só copia tipo/valor), fidelidade ou painel. O allow-list de tabelas prova isso.
- Um responsável por OS: só a coluna `responsavel_id`, sem "Entrar" e sem divisão. Os adicionais exigem um principal. Entregue e cancelada são terminais.
- §3/§5.2 batem com a tabela `TRANSICOES` e com a regra do lavador "só para si" (`abrirOs` recusa até o próprio id: desvio aceito na T5, mais estrito que a spec).
- §6: o menu lateral do balcão virou menu superior → ruling T10, decisão de design para a Fase 2.
- Desvio do plano: serviços de exemplo inativos e sem preço, em vez de "preço zero" (decisão de segurança da T14, aceita).
- Docs: README e CODEBASE_MAP conferidos pela T15 contra a árvore; conferi por amostragem os scripts, os projetos do Playwright, o aviso "CI nunca executada" e o aviso do `public/` no standalone, e estão corretos. O plano está marcado como concluído, com a ressalva do CI escrita (linha 11), e não sobrou checkbox aberto.

## Triagem de todo item adiado e ⚠️

| Origem | Item | Decisão | Motivo |
|---|---|---|---|
| T1 | `linhaMembro` FOR UPDATE | MUST-FIX | Mesma palavra do I1 |
| T1 | cascade de os_itens/os_eventos a partir da OS, com o runtime tendo DELETE | FASE-4 | Registros financeiros: ON DELETE restrict/no action e revogar DELETE nas tabelas financeiras (lava_jatos também cascateia tudo) |
| T1 | sem CHECK numero>0 / coerência do total | ACCEPT | Só o servidor grava; reavaliar com a fidelidade |
| T1 | o loop da barreira gira até o timeout no caminho de erro | ACCEPT | Só piora a mensagem de um teste que já falha |
| T2 | sem unique de nome por tenant | FASE-6 | Duplicata é inofensiva; polir na Gestão |
| T2 | negação na página do catálogo não é logada | ACCEPT | A página não lê dados; as actions logam |
| T2 | campos não controlados após o refresh | FASE-2 | UX |
| T2 | "1.234,56" recusado | ACCEPT | Seguro, com mensagem |
| T2 ⚠️ | UI do catálogo nunca vista em navegador | ACCEPT (fechado) | Coberta pelo E2E do fluxo da T15 + screenshots |
| T3 | listas sem paginação | FASE-6 | Milhares de clientes por tenant só depois de meses de uso |
| T3 | Alerta/useEnvio em catalogo-form | FASE-2 | Já tem 5 consumidores (M7) |
| T3 | dados digitados descartados quando a placa existe | FASE-2 | UX da Nova OS |
| T3 | testes de corrida sem barreira | ACCEPT | Guardas de regressão; o unique do banco garante |
| T3 | checagem dupla de permissão no cadastroRapido | ACCEPT | Redundante, inofensiva |
| T3 | celular legado de 10 dígitos recusado | ACCEPT | Correto para o WhatsApp |
| T4 | soma de muitos inteiros seguros | ACCEPT | No máximo 30 itens × teto + `cabeNoBanco` |
| T4 | falta o teste pronto→em_lavagem para dono/gerente | ACCEPT | A varredura 5×5 cobre a tabela |
| T5 | `veValores` helper | ACCEPT (fechado) | Feito |
| T5 | FOR SHARE no lavador ativo | ACCEPT (fechado) | Feito na T6 |
| T5 | estouro de int4 na soma | ACCEPT (fechado) | Teto da T7 |
| T5 | o teste conta os waits do banco inteiro | ACCEPT | Os arquivos rodam em série |
| T5 | ordem dos itens | ACCEPT | (createdAt,id) estável |
| T6 | deadlock equipe×ordens | MUST-FIX | I1, uma palavra |
| T6 | mapeamento lock_timeout→CONFLITO_OS sem teste | FASE-2 | Falha segura (ERRO_INTERNO) |
| T6 | texto "já foi pega" após correção | ACCEPT | Cosmético |
| T6 | abrirOs sem lock_timeout | FASE-2 | M2, uma linha (pode ir junto com o I1) |
| T6 | Pegar idempotente pula a permissão | ACCEPT | Só devolve a leitura da própria OS |
| T6 | sem teste de desativação concorrente na atribuição | MUST-FIX | Vem junto com o teste do I1 |
| T6 ⚠️ | recarregar a fila nos 3 erros | ACCEPT (fechado) | `ERROS_RECARREGAR_FILA` nos dois componentes |
| T7 | `!` em buscarVeiculo | ACCEPT | FK garante |
| T7 | erro "sem principal" no campo `remover` | ACCEPT | Cosmético |
| T7 | sem teste de concorrência de editarItens/ajustarValor | ACCEPT | O caminho `travarOs` é compartilhado e testado |
| T7 | `cabeNoBanco` depois do delete/insert | ACCEPT | Mesma transação |
| T7 | preços legados acima do teto | ACCEPT | Nunca houve deploy; as somas são guardadas |
| T7 | teste do lavador com ctx falso | ACCEPT | O E2E cobre a resposta real |
| T8 | itens.filter O(n·m), fila sem paginação | ACCEPT | A fila é limitada pelo pátio |
| T8 | RED retroativo | ACCEPT | Processo |
| T8 | desempate com uuids aleatórios | ACCEPT | Teste fraco, implementação certa |
| T8 | sem guarda contra server-only em componente cliente | ACCEPT | O `next build` (dentro do verify) falha |
| T9 | enqueue sem limite para cliente travado | FASE-8 | Pouco volume; rever com carga |
| T9 | backoff reseta | ACCEPT | Limitado |
| T9 | ajustarValor publica sem mudança | ACCEPT | Uma recarga extra |
| T9 | abort em desconexão real | ACCEPT (fechado) | Verificado no standalone (≤10 s) |
| T9 | listener de abort, heartbeat sobreposto, 1 query/25 s | ACCEPT | Desprezível |
| T10 | N consultas por porte na nova-os | ACCEPT | Poucos portes |
| T10 | menu lateral §6 | FASE-2 | Layout do painel |
| T10 | Vitest×Playwright sem lock mútuo | FASE-2 | `pg_try_advisory_lock` nos dois setups, barato; o verify roda em série |
| T10 | `/api/teste/assinantes` | ACCEPT | Gate do env do servidor, falha fechada, só um número; opcional: teste de 404 em production |
| T10 | reload falho mantém `aposRecarga`/descarta resposta | ACCEPT | Transitório |
| T10 | falta o teste do porte travado | ACCEPT | UX |
| T10 | desmontar no meio da sonda; loop de 5xx com backoff | ACCEPT | Por desenho |
| T10 | 'Reconectando…'/sonda | ACCEPT | Lógica conferida (`use-eventos.ts:42-56`) |
| T11 ⚠️ | nginx loga o token | FASE-8 | Mascarar no log_format |
| T11 | evicção do mapa do rate limit | ACCEPT | Exige ~10k IPs/min |
| T11 | OpenGraph não verificado | ACCEPT | Título fixo |
| T11 | throw de addEventListener | ACCEPT | Impossível na prática |
| T11 | limitador em memória, X-Real-IP | FASE-8 | Um processo; o nginx DEVE setar X-Real-IP (senão todo mundo cai num balde só) |
| T12 | `useState(telefone)` velho | ACCEPT | Corrige ao remontar |
| T12 | sobrescrever telefone malformado | ACCEPT | Raro |
| T12 | fixo de 10 dígitos no wa.me | ACCEPT | O WhatsApp responde |
| T12 | env + join por carga | ACCEPT | Barato |
| T12 | colisão de placas aleatórias | ACCEPT | Desprezível |
| T12 ⚠️ | BETTER_AUTH_URL https público | FASE-8 | Checklist de deploy |
| T13 | wake lock duplo / `erroDe` sem fieldErrors | ACCEPT | Inofensivo |
| T13 ⚠️ | standalone sem `public/` e `.next/static` | FASE-8 | Dockerfile; documentado no README |
| T13 | clienteId ao lavador | FASE-2 (ou já) | Busca corrigida; o cadastroRapido ainda devolve (M1) |
| T13 | redirect duplicado layout/página | ACCEPT | Intencional |
| T14 | depende de READ COMMITTED | ACCEPT | Padrão do pg; comentar |
| T14 | 55P03 com mensagem de equipe | ACCEPT | O assistente roda uma vez |
| T14 | IDENTIDADE_EM_USO não marca o campo | FASE-2 | UX |
| T14 | reescrita `"public".` no global-setup | ACCEPT (fechado) | Guarda feita na T15 |
| T14 | JSDoc solto | ACCEPT | Cosmético |
| T14 ⚠️ | X-Real-IP / rotação do setup token / limitador em memória | FASE-8 | Checklist de deploy |
| T15 | regex não pega `describe.sequential.skip` | ACCEPT | Barato acrescentar quando alguém usar `sequential` |
| T15 | no-reload do fluxo fora da página do lavador | ACCEPT | O spec do lavador cobre o SSE |
| T15 | guard `\bpublic\b` estrito | ACCEPT | Falha alto |
| T15 | prova do 1º E2E é "falha em algum ponto" | ACCEPT | Aceitável para um teste de fluxo |
| T15 | CI nunca executado | MUST-FIX (antes da `main`) | I3, depende de push do usuário |
| Fundação | tenant FOR UPDATE → no key update | ACCEPT (fechado) | Feito |
| Fundação | get-session × versão do PIN | FASE-3 | Nenhum consumidor no caminho do PIN hoje (só `login-form` após e-mail); o app nativo vai usar |
| Fundação | `findCredential`/`PRODUCT_NAME` | MUST-FIX | I2, apagar |
| Fundação | log de negação com a permissão correta | MUST-FIX | I2 |
| Fundação | T4 assert / T7 foco / T8 replay | FASE-2 | M10 |

## Declinei julgar

- `observacoes` da OS (texto livre do balcão) chega ao lavador: se alguém digitar um valor ali, o lavador vê. A spec fala de campos de valor, não de texto do usuário. A regra pertence a quem decide o produto.
- `/api/eventos` interno sem limite de streams por usuário: é autenticado e o volume é baixo. Não é escopo desta fase.
- O `tipo: 'valor'` no SSE revela ao lavador que houve ajuste (sem o valor). Considero aceitável.
- A desativação de um lavador com OSs em lavagem não as desatribui: a spec não diz nada e o balcão pode reatribuir.
- A UX dos formulários (catálogo, clientes, WhatsApp) e a acessibilidade do PWA: não li a fundo e confiei nas revisões por tarefa e nos screenshots do controller.

## O que não verifiquei

- Não rodei nenhuma suíte nem teste.
- Não reproduzi o deadlock. A análise é pela tabela de conflitos de lock do Postgres.
- Não li linha a linha os specs E2E nem os componentes de formulário.
- Não testei em aparelho Android real, com nginx ou contra o CI do GitHub.
- Não conferi de novo, linha a linha, os números de arquivos/linhas do CODEBASE_MAP (a T15 conferiu).
