# Mapa do código — LavaOS

Gerado a partir da árvore da branch `fase-1-operacao` em 2026-10-30, ao fim da Fase 1; atualizado na branch `fase-4-dinheiro` em 2026-10-31, ao fim da Fase 4 (Dinheiro).
Contagem (`git ls-files`, 2026-10-31): 225 arquivos versionados fora de `docs/superpowers/` (sem contar este mapa); `src/` tem 121 arquivos (7609 linhas), `tests/` tem 68 (8228 linhas).

## Visão geral

Aplicação Next.js 16 única (App Router, servidor Node de longa duração, `output: standalone`) sobre Postgres 16 via Drizzle. Better Auth cuida de sessões: e-mail/senha para staff e um plugin próprio de usuário/PIN para o lavador. O tenant é o `lava_jato`; todo dado de domínio carrega `tenant_id`, e toda consulta de repositório recebe `TenantContext` e filtra por `ctx.tenantId` (a única leitura sem contexto é o link público, pelo token). A autorização real acontece no servidor: `requirePermission` (sessão → vínculo ativo → perfil → permissão) antes de qualquer leitura ou escrita; o `proxy.ts` só redireciona quem não tem cookie e limita a página pública.

Padrão de cada módulo: `*.rules.ts` (regras puras) → `*.repo.ts` (consultas com `TenantContext`) → `*.service.ts` (transação, revalida tudo) → `*.actions.ts` (server action: permissão + Zod estrito, resultado `{ ok, data } | { ok: false, code, message }`).

### Tempo real (SSE)

1. Toda escrita de OS, pagamento ou caixa chama `publicar()` (`lib/realtime/publicar.ts`) **dentro da transação**: `pg_notify('lavaos_eventos', {tenantId, osId, tipo})` — só ids e tipo, nunca R$, nomes ou token; eventos de `caixa` não têm `osId` e nunca chegam ao SSE público. Rollback não publica.
2. `lib/realtime/listener.ts`: uma conexão `LISTEN` dedicada por processo, com reconexão e backoff; a cada LISTEN ativo emite `resync`.
3. `lib/realtime/hub.ts`: conjunto de assinantes em memória, filtrado por tenant (e por OS, no link público).
4. Rotas SSE: `api/eventos` (com sessão; fecha quando o acesso é revogado) e `api/acompanhar/[token]/eventos` (público, rate limit por IP).
5. Clientes: `components/use-eventos.ts` (fila e app do lavador) e `app/acompanhar/[token]/ao-vivo.tsx` recarregam a **própria visão** por requisição normal a cada evento; a visão já vem filtrada por perfil (`ordens.views.ts`: o lavador nunca recebe valores).

## Raiz

| Arquivo | Papel |
|---|---|
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version` | Dependências fixadas, scripts, Node 24.x / pnpm 11.x |
| `compose.yaml` | Postgres 16 local em `127.0.0.1:55432` |
| `.env.example` | Variáveis do app (cópia para `.env.local`, ignorado pelo git), inclusive `LAVAOS_SETUP_TOKEN` comentado |
| `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` | Configuração de build, tipos, lint e Tailwind |
| `drizzle.config.ts` | drizzle-kit com a role de DDL (`MIGRATION_DATABASE_URL`) |
| `vitest.config.ts` | Projetos `unit` e `integration` em sequência, arquivos em série |
| `playwright.config.ts` | E2E contra o build standalone: servidor `:3100` (assistente desligado) e `:3101` (assistente ligado, schema `onboarding`); projetos abaixo |
| `.github/workflows/quality.yml` | CI: Postgres 16 de serviço, roles via `scripts/db-local-init.sql`, migrations, `pnpm verify:operacao` (nunca executada no GitHub) |
| `README.md` | Ambiente, URLs, Fases 1, 2 e 4, PWA, variáveis, qualidade, limites e notas de produção |
| `public/icons/` | Ícones PNG do PWA (192, 512 e maskable 512) |

## `drizzle/`

| Arquivo | Papel |
|---|---|
| `0000_fundacao.sql` | Tabelas Better Auth (`user`, `session`, `account`, `verification`), `lava_jatos`, `membros`, `convites`, `credenciais_lavador` (sem grants: o DML do `lavaos_app` vem do `ALTER DEFAULT PRIVILEGES` em `db-local-init.sql`) |
| `0001_org_plugin_campos.sql` | Colunas `logo`/`metadata` exigidas pelo plugin de organização |
| `0002_pin_sessao_e_limite_origem.sql` | Vínculo sessão ↔ credencial PIN e `tentativas_pin_origem` |
| `0003_operacao.sql` | `portes`, `servicos`, `precos`, `clientes`, `veiculos`, `ordens_servico`, `os_itens`, `os_eventos`, `os_contadores` |
| `0004_amazing_morgan_stark.sql` | Placa opcional em `veiculos` (veículo sem placa, Fase 2) |
| `0005_financeiro.sql` | `caixas`, `pagamentos`, `categorias_despesa`, `despesas`; categorias padrão para tenants existentes; `REVOKE DELETE` dessas tabelas do `lavaos_app` |
| `meta/` | Journal e snapshots do drizzle-kit |

### Tabelas (as de domínio da Fase 1 têm `id` uuid, `tenant_id`, `created_at`, `updated_at` e FKs compostas `(tenant_id, id)`; exceção: `os_contadores`, uma linha por tenant com chave `tenant_id`)

| Tabela | Conteúdo |
|---|---|
| `lava_jatos`, `membros`, `convites`, `credenciais_lavador`, `tentativas_pin_origem` | Tenant, vínculo usuário × perfil, PIN do lavador e limite por origem (Fase 0) |
| `portes`, `servicos`, `precos` | Catálogo: porte, serviço (principal/adicional, comissão percentual em pontos-base ou fixa em centavos), preço por serviço × porte em centavos |
| `clientes`, `veiculos` | Cliente (telefone E.164) e veículo (placa normalizada única por tenant, porte, cliente opcional) |
| `ordens_servico` | OS: número sequencial por tenant, status, `aberta_por`, `responsavel_id` único, totais em centavos, marcos de tempo, motivo de cancelamento, `token_publico` |
| `os_itens` | Itens com nome, valor e comissão **copiados** na inclusão |
| `os_eventos` | Histórico: status, responsável, itens e valor, com o autor (`membro_id`) |
| `os_contadores` | Último número de OS por tenant (upsert travado na transação) |
| `caixas` | Caixa do dia (Fase 4): `data` única por tenant, troco inicial, abertura/fechamento com autor, dinheiro contado e diferença, `status`; índice único parcial: um `aberto` por tenant |
| `pagamentos` | Pagamento de OS num caixa: forma (dinheiro, Pix, débito, crédito), valor > 0, quem recebeu; estorno com autor, data e motivo (os três juntos ou nenhum) |
| `categorias_despesa` | Nome único por tenant, ativa, `sistema` ("Comissões") |
| `despesas` | Categoria, descrição, valor, vencimento e/ou `pago_em`, `caixa_id` quando paga com dinheiro da gaveta, cancelamento com motivo |

## `scripts/`

| Arquivo | Papel |
|---|---|
| `db-local-init.sql` | Roles `lavaos_owner` (DDL) e `lavaos_app` (DML), bancos `lavaos_dev`/`lavaos_test` (compose e CI) |
| `seed-dev.ts` | `pnpm db:seed:dev`: tenant + dono local; recusa produção e bancos não locais |
| `verify-operacao.ts` | `pnpm verify:operacao`: lint → typecheck → test → build → E2E, falha imediata; recusa `.only/.skip/.todo/.fixme`, `skipIf/runIf`, `concurrent.skip`, `xit/xdescribe/fit` |
| `gerar-icones.ts` | Gera os ícones do PWA a partir de um SVG com o Chromium do Playwright |

## `src/`

### `app/` (rotas)

| Rota | Arquivo | Quem |
|---|---|---|
| `/` | `page.tsx` | Leva ao início do perfil com sessão válida, senão ao login |
| `/login` | `login/page.tsx` | Staff (e-mail/senha) e lavador (usuário/PIN) |
| `/primeiro-acesso` | `primeiro-acesso/page.tsx` | Público; 404 sem `LAVAOS_SETUP_TOKEN` |
| `/painel` | `(interno)/painel/page.tsx` | Dono, gerente e recepção (`painel:ver`); lavador vai a `/lavador` |
| `/caixa` | `(interno)/caixa/page.tsx` | Dono, gerente e recepção (`caixa:operar`) |
| `/despesas` | `(interno)/despesas/page.tsx` | Dono e gerente (`despesas:gerenciar`); recepção vê "Acesso negado" |
| `/inicio`, `/fila`, `/nova-os`, `/clientes` | `(interno)/…/page.tsx` | Dono, gerente e recepção (lavador vai a `/lavador`) |
| `/configuracoes/catalogo`, `/configuracoes/equipe` | `(interno)/configuracoes/…` | Dono e gerente; demais veem "Acesso negado" |
| `/lavador`, `/lavador/nova` | `(lavador)/lavador/…` | Só lavador (staff vai a `/fila`); layout com barra inferior |
| `/acompanhar/[token]` | `acompanhar/[token]/page.tsx`, `ao-vivo.tsx` | Público, por token |
| `/manifest.webmanifest` | `manifest.ts` | Manifest do PWA (`start_url` `/lavador`, standalone, pt-BR) |
| `/api/auth/*` | `api/auth/[...all]/route.ts` | Better Auth atrás da whitelist |
| `/api/eventos` | `api/eventos/route.ts` | SSE da fila (com sessão) |
| `/api/acompanhar/[token]/eventos` | `api/acompanhar/[token]/eventos/route.ts` | SSE público da OS |
| `/api/teste/assinantes` | `api/teste/assinantes/route.ts` | Só com `LAVAOS_MODE=test` (contagem de assinantes SSE); 404 fora disso |

`layout.tsx` e `globals.css`: layout raiz (pt-BR) e tema Tailwind. `(interno)/layout.tsx` e `(lavador)/layout.tsx` exigem contexto de tenant.

### `components/`

| Arquivo | Papel |
|---|---|
| `app-shell.tsx` | Menu lateral (desktop) e abas inferiores (celular) por perfil; com mais de 5 itens, 4 abas + "Mais" |
| `painel-view.tsx` | Painel ao vivo: cartões de contagem, tempo médio, atrasadas, lavadores e "Recebido hoje" (por forma e estado do caixa); recarga por SSE e a cada 60 s |
| `caixa-view.tsx` | Caixa do dia: abrir com troco, recebido por forma, pagamentos com estorno, saídas, conferir/fechar e reabrir |
| `receber-dialogo.tsx` | Receber / Receber e entregar: forma, valor (sugere o saldo) e troco em dinheiro |
| `despesas-view.tsx` | Lançar despesa (paga, a pagar ou com dinheiro do caixa), contas a pagar, despesas do mês e categorias |
| `login-form.tsx`, `primeiro-acesso-form.tsx` | Login (dois modos, escolha de lava jato) e assistente |
| `equipe-form.tsx`, `catalogo-form.tsx`, `clientes-form.tsx` | Telas de cadastro |
| `nova-os-form.tsx` | Nova OS / Nova lavagem: busca da placa, cadastro rápido, serviços, responsável opcional |
| `fila-board.tsx` | Fila em colunas com ações por permissão, diálogos (direcionar, iniciar, cancelar, editar, receber, reabrir), "Pago R$ x de R$ y", "Entregues hoje" e recarga por SSE |
| `whatsapp-button.tsx` | "Enviar acompanhamento" / "Avisar pronto" (`wa.me`), pede e salva telefone |
| `use-eventos.ts` | EventSource com reconexão, "Reconectando…" e ida ao login quando o acesso acaba |
| `lavador/cartao-os.tsx`, `barra-inferior.tsx`, `instalar-app.tsx`, `sair.tsx`, `use-vibrar.ts`, `use-wake-lock.ts` | App do lavador |
| `ui/button.tsx`, `ui/input.tsx`, `ui/label.tsx`, `ui/modal.tsx` | Primitivos de UI (diálogo e motivo) |
| `ui/placa.tsx`, `ui/icones.tsx`, `ui/status-visual.ts` | Placa Mercosul, ícones do menu e tinta por status |

### `lib/`

| Arquivo | Papel |
|---|---|
| `env.ts` | Validação lazy das variáveis; `TEST_DATABASE_URL` só `lavaos_test` local |
| `utils.ts` | `cn`, `tempoDesde` e `SEM_CONEXAO` |
| `rate-limit.ts` | Limitador em memória (página pública, SSE público, assistente) |
| `db/client.ts`, `db/types.ts`, `db/schema/*` | Pool Postgres, tipo `Database` e schema Drizzle (`auth`, `equipe`, `credenciais`, `catalogo`, `clientes`, `ordens`, `financeiro`) |
| `auth/server.ts`, `client.ts`, `route-policy.ts`, `context.ts`, `permissions.ts`, `types.ts`, `ip.ts` | Better Auth, whitelist, `requirePermission`, matriz perfil × permissão (`IMPLANTADAS`), IP só de `X-Real-IP` |
| `auth/pin.plugin.ts`, `pin.repo.ts`, `pin.rules.ts`, `credentials.ts` | Login por PIN, bloqueio persistente e hash scrypt |
| `realtime/publicar.ts`, `listener.ts`, `hub.ts` | Tempo real (acima) |

### `modules/`

| Módulo | Arquivos | Papel |
|---|---|---|
| `equipe` | actions, schemas, service, repo, rules | Cadastro, redefinição de PIN, desativação |
| `catalogo` | actions, schemas, service, repo, rules | Portes, serviços, preços e comissão; conversão R$ ↔ centavos |
| `clientes` | actions, schemas, service, repo, rules, `whatsapp.rules.ts` | Clientes/veículos, placa e telefone normalizados, busca por placa (o lavador recebe só o nome do cliente), mensagens `wa.me` |
| `ordens` | actions, schemas, service, repo, rules, `ordens.views.ts`, `publico.repo.ts` | Abrir OS, transições com `UPDATE … WHERE status = esperado` e conflito PT-BR, entrega só quitada, cancelamento sem pagamento ativo, reabertura `entregue → pronto`, responsável, itens/valor (nunca abaixo do pago), fila, sugestão de lavador livre, visão por perfil (`pagoCentavos` só na gestão) e leitura pública por token |
| `caixa` | actions, schemas, service, repo, rules | Abrir, receber (trava OS → caixa), estornar, fechar e reabrir o caixa do dia; troco, saldo da OS, esperado por forma e diferença |
| `despesas` | actions, schemas, service, repo, `categorias-padrao.ts` | Lançar, marcar como paga e cancelar despesa; saída de dinheiro do caixa; contas a pagar (vencidas pela data de São Paulo); categorias |
| `painel` | actions, repo, rules | Leitura do painel (contagens, tempo médio, lavadores, atrasadas > 60 min, recebido do dia por forma e estado do caixa; dia em America/Sao_Paulo) |
| `lava-jato` | `primeiro-acesso.actions/schemas/service/rules` | Assistente de instalação |

### `proxy.ts`

Redireciona ao login quem não tem cookie (`/inicio`, `/painel`, `/fila`, `/caixa`, `/despesas`, `/lavador/*`, `/nova-os`, `/clientes`, `/configuracoes/*`), guardando o retorno em `next`, e aplica rate limit, `no-referrer` e `noindex` em `/acompanhar/*`.

## `tests/`

| Pasta / arquivo | Papel |
|---|---|
| `unit/` (16) | Regras puras: caixa (`caixa.rules`), painel (`painel.rules`), auth/rotas, env, equipe, permissões, PIN, catálogo, clientes, WhatsApp, ordens, visões, hub, rate limit, primeiro acesso |
| `integration/` (29) | Postgres real em `lavaos_test`: caixa (`caixa`, `caixa-actions`, `caixa-concorrencia`), despesas, schema financeiro, painel (`painel-repo`, `painel-actions`), lock de suítes (`lock-suites`), schema/constraints, guards, contexto, auth, equipe, catálogo, clientes, ordens (abrir, transições, concorrência, edição, fila), público, tempo real, primeiro acesso, seed |
| `e2e/foundation-*.spec.ts` | Login, equipe e suíte adversarial da Fase 0 |
| `e2e/operacao-fila.spec.ts`, `operacao-whatsapp.spec.ts`, `operacao-publico.spec.ts` | Fila/Nova OS, botões `wa.me` e link público (projetos `desktop` e `mobile` 390×844) |
| `e2e/operacao-fluxo.spec.ts` | Fluxo ponta a ponta (recepção → lavador no celular → SSE → pronto → avisar → entregar → link público) e OS cancelada somente leitura (`desktop` e `mobile`) |
| `e2e/painel.spec.ts` | Painel: SSE sem recarregar, OS atrasada, "Recebido hoje" ao vivo, recepção sem telefone/link público, redirecionamentos (`desktop`, `mobile` e `android-small` 360×640) |
| `e2e/caixa.spec.ts`, `e2e/despesas.spec.ts` | Fluxo do caixa (abrir → receber Pix + dinheiro com troco → entregar → vale da gaveta → fechar sem diferença → reabrir OS, estornar e "Falta receber") e despesas (`desktop` e `mobile`) |
| `e2e/dinheiro.ts` | Helpers: `quitarOs`, `liberarCaixaDeHoje`, `semearOsPronta` |
| `e2e/operacao-lavador.spec.ts` | App do lavador, inclusive nenhum R$/`pagoCentavos`/pagamento com uma OS paga na fila (projetos `android` 412×915 e `android-small` 360×640) |
| `e2e/operacao-primeiro-acesso.spec.ts` | Assistente (`onboarding-desktop` e `onboarding-mobile`, servidor `:3101`) |
| `e2e/global-setup.ts`, `e2e/login.ts` | Zera `lavaos_test`, migra (e copia as migrations para o schema `onboarding`), cria fixtures com segredos por execução; helpers de login |
| `helpers/` | `test-db.ts` (fonte única das URLs + trava), `db.ts`, `fixtures.ts`, `auth.ts`, `http.ts`, `ordens.ts`, `empty.ts` |

## Fora desta fase

Geração de comissões e vales do lavador (5), produção (8), agenda/relatórios (6), avaliação (7), app nativo (3), fidelidade (9); fiado; WhatsApp automático.
