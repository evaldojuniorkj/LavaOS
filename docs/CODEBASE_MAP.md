# Mapa do código — LavaOS

Gerado a partir da árvore real da branch `fase-1-operacao` em 2026-10-30 01:25 -0400, ao fim da Fase 1 (Operação).
Contagem (`git ls-files`): 179 arquivos versionados fora de `docs/superpowers/` (sem contar este mapa); `src/` tem 95 arquivos (5512 linhas), `tests/` tem 52 (6434 linhas).

## Visão geral

Aplicação Next.js 16 única (App Router, servidor Node de longa duração, `output: standalone`) sobre Postgres 16 via Drizzle. Better Auth cuida de sessões: e-mail/senha para staff e um plugin próprio de usuário/PIN para o lavador. O tenant é o `lava_jato`; todo dado de domínio carrega `tenant_id`, e toda consulta de repositório recebe `TenantContext` e filtra por `ctx.tenantId` (a única leitura sem contexto é o link público, pelo token). A autorização real acontece no servidor: `requirePermission` (sessão → vínculo ativo → perfil → permissão) antes de qualquer leitura ou escrita; o `proxy.ts` só redireciona quem não tem cookie e limita a página pública.

Padrão de cada módulo: `*.rules.ts` (regras puras) → `*.repo.ts` (consultas com `TenantContext`) → `*.service.ts` (transação, revalida tudo) → `*.actions.ts` (server action: permissão + Zod estrito, resultado `{ ok, data } | { ok: false, code, message }`).

### Tempo real (SSE)

1. Toda escrita de OS chama `publicar()` (`lib/realtime/publicar.ts`) **dentro da transação**: `pg_notify('lavaos_eventos', {tenantId, osId, tipo})` — só ids e tipo, nunca R$, nomes ou token. Rollback não publica.
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
| `README.md` | Ambiente, URLs, Fase 1, PWA, variáveis, qualidade, limites e notas de produção |
| `public/icons/` | Ícones PNG do PWA (192, 512 e maskable 512) |

## `drizzle/`

| Arquivo | Papel |
|---|---|
| `0000_fundacao.sql` | Tabelas Better Auth (`user`, `session`, `account`, `verification`), `lava_jatos`, `membros`, `convites`, `credenciais_lavador` (sem grants: o DML do `lavaos_app` vem do `ALTER DEFAULT PRIVILEGES` em `db-local-init.sql`) |
| `0001_org_plugin_campos.sql` | Colunas `logo`/`metadata` exigidas pelo plugin de organização |
| `0002_pin_sessao_e_limite_origem.sql` | Vínculo sessão ↔ credencial PIN e `tentativas_pin_origem` |
| `0003_operacao.sql` | `portes`, `servicos`, `precos`, `clientes`, `veiculos`, `ordens_servico`, `os_itens`, `os_eventos`, `os_contadores` |
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

## `scripts/`

| Arquivo | Papel |
|---|---|
| `db-local-init.sql` | Roles `lavaos_owner` (DDL) e `lavaos_app` (DML), bancos `lavaos_dev`/`lavaos_test` (compose e CI) |
| `seed-dev.ts` | `pnpm db:seed:dev`: tenant + dono local; recusa produção e bancos não locais |
| `verify-operacao.ts` | `pnpm verify:operacao` (e o alias `verify:foundation`): lint → typecheck → test → build → E2E, falha imediata; recusa `.only/.skip/.todo/.fixme`, `skipIf/runIf`, `concurrent.skip`, `xit/xdescribe/fit` |
| `gerar-icones.ts` | Gera os ícones do PWA a partir de um SVG com o Chromium do Playwright |

## `src/`

### `app/` (rotas)

| Rota | Arquivo | Quem |
|---|---|---|
| `/` | `page.tsx` | Leva ao início do perfil com sessão válida, senão ao login |
| `/login` | `login/page.tsx` | Staff (e-mail/senha) e lavador (usuário/PIN) |
| `/primeiro-acesso` | `primeiro-acesso/page.tsx` | Público; 404 sem `LAVAOS_SETUP_TOKEN` |
| `/painel` | `(interno)/painel/page.tsx` | Dono, gerente e recepção (`painel:ver`); lavador vai a `/lavador` |
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
| `app-shell.tsx` | Menu lateral (desktop) e abas inferiores (celular) por perfil |
| `painel-view.tsx` | Painel ao vivo: cartões de contagem, tempo médio, atrasadas e lavadores; recarga por SSE e a cada 60 s |
| `login-form.tsx`, `primeiro-acesso-form.tsx` | Login (dois modos, escolha de lava jato) e assistente |
| `equipe-form.tsx`, `catalogo-form.tsx`, `clientes-form.tsx` | Telas de cadastro |
| `nova-os-form.tsx` | Nova OS / Nova lavagem: busca da placa, cadastro rápido, serviços, responsável opcional |
| `fila-board.tsx` | Fila em colunas com ações por permissão, diálogos (direcionar, iniciar, cancelar, editar) e recarga por SSE |
| `whatsapp-button.tsx` | "Enviar acompanhamento" / "Avisar pronto" (`wa.me`), pede e salva telefone |
| `use-eventos.ts` | EventSource com reconexão, "Reconectando…" e ida ao login quando o acesso acaba |
| `lavador/cartao-os.tsx`, `barra-inferior.tsx`, `instalar-app.tsx`, `sair.tsx`, `use-vibrar.ts`, `use-wake-lock.ts` | App do lavador |
| `ui/button.tsx`, `ui/input.tsx`, `ui/label.tsx` | Primitivos de UI |
| `ui/placa.tsx`, `ui/icones.tsx`, `ui/status-visual.ts` | Placa Mercosul, ícones do menu e tinta por status |

### `lib/`

| Arquivo | Papel |
|---|---|
| `env.ts` | Validação lazy das variáveis; `TEST_DATABASE_URL` só `lavaos_test` local |
| `utils.ts` | `cn` e `tempoDesde` |
| `rate-limit.ts` | Limitador em memória (página pública, SSE público, assistente) |
| `db/client.ts`, `db/types.ts`, `db/schema/*` | Pool Postgres, tipo `Database` e schema Drizzle (`auth`, `equipe`, `credenciais`, `catalogo`, `clientes`, `ordens`) |
| `auth/server.ts`, `client.ts`, `route-policy.ts`, `context.ts`, `permissions.ts`, `types.ts`, `ip.ts` | Better Auth, whitelist, `requirePermission`, matriz perfil × permissão (`IMPLANTADAS`), IP só de `X-Real-IP` |
| `auth/pin.plugin.ts`, `pin.repo.ts`, `pin.rules.ts`, `credentials.ts` | Login por PIN, bloqueio persistente e hash scrypt |
| `realtime/publicar.ts`, `listener.ts`, `hub.ts` | Tempo real (acima) |

### `modules/`

| Módulo | Arquivos | Papel |
|---|---|---|
| `equipe` | actions, schemas, service, repo, rules | Cadastro, redefinição de PIN, desativação |
| `catalogo` | actions, schemas, service, repo, rules | Portes, serviços, preços e comissão; conversão R$ ↔ centavos |
| `clientes` | actions, schemas, service, repo, rules, `whatsapp.rules.ts` | Clientes/veículos, placa e telefone normalizados, busca por placa (o lavador recebe só o nome do cliente), mensagens `wa.me` |
| `ordens` | actions, schemas, service, repo, rules, `ordens.views.ts`, `publico.repo.ts` | Abrir OS, transições com `UPDATE … WHERE status = esperado` e conflito PT-BR, responsável, itens/valor, fila, sugestão de lavador livre, visão por perfil e leitura pública por token |
| `painel` | actions, repo, rules | Leitura do painel (contagens, tempo médio, lavadores, atrasadas > 60 min; dia em America/Sao_Paulo), sem valores |
| `lava-jato` | `primeiro-acesso.actions/schemas/service/rules` | Assistente de instalação |

### `proxy.ts`

Redireciona ao login quem não tem cookie (`/inicio`, `/painel`, `/fila`, `/lavador/*`, `/nova-os`, `/clientes`, `/configuracoes/*`), guardando o retorno em `next`, e aplica rate limit, `no-referrer` e `noindex` em `/acompanhar/*`.

## `tests/`

| Pasta / arquivo | Papel |
|---|---|
| `unit/` (15) | Regras puras: painel (`painel.rules`), auth/rotas, env, equipe, permissões, PIN, catálogo, clientes, WhatsApp, ordens, visões, hub, rate limit, primeiro acesso |
| `integration/` (24) | Postgres real em `lavaos_test`: painel (`painel-repo`, `painel-actions`), lock de suítes (`lock-suites`), schema/constraints, guards, contexto, auth, equipe, catálogo, clientes, ordens (abrir, transições, concorrência, edição, fila), público, tempo real, primeiro acesso, seed |
| `e2e/foundation-*.spec.ts` | Login, equipe e suíte adversarial da Fase 0 |
| `e2e/operacao-fila.spec.ts`, `operacao-whatsapp.spec.ts`, `operacao-publico.spec.ts` | Fila/Nova OS, botões `wa.me` e link público (projetos `desktop` e `mobile` 390×844) |
| `e2e/operacao-fluxo.spec.ts` | Fluxo ponta a ponta (recepção → lavador no celular → SSE → pronto → avisar → entregar → link público) e OS cancelada somente leitura (`desktop` e `mobile`) |
| `e2e/painel.spec.ts` | Painel: SSE sem recarregar, OS atrasada, recepção sem R$/telefone, redirecionamentos (`desktop`, `mobile` e `android-small` 360×640) |
| `e2e/operacao-lavador.spec.ts` | App do lavador (projetos `android` 412×915 e `android-small` 360×640) |
| `e2e/operacao-primeiro-acesso.spec.ts` | Assistente (`onboarding-desktop` e `onboarding-mobile`, servidor `:3101`) |
| `e2e/global-setup.ts`, `e2e/login.ts` | Zera `lavaos_test`, migra (e copia as migrations para o schema `onboarding`), cria fixtures com segredos por execução; helpers de login |
| `helpers/` | `test-db.ts` (fonte única das URLs + trava), `db.ts`, `fixtures.ts`, `auth.ts`, `http.ts`, `ordens.ts`, `empty.ts` |

## Fora desta fase

App nativo (3), pagamento/caixa (4), geração de comissões (5), agenda/relatórios (6), avaliação (7), produção (8), fidelidade (9); reabrir OS entregue; WhatsApp automático.
