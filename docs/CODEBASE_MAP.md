# Mapa do código — LavaOS

Gerado a partir da árvore real da branch `fase-0-fundacao` em 2026-10-28 00:15 -0400, ao fim da Fase 0 (Fundação).
Contagem: 89 arquivos versionados fora de `docs/superpowers/` (sem contar este mapa); `src/` tem 38 arquivos (1673 linhas), `tests/` tem 25 (2406 linhas).

## Visão geral

Aplicação Next.js 16 única (App Router, servidor Node de longa duração, `output: standalone`) sobre Postgres 16 via Drizzle. Better Auth cuida de sessões: e-mail/senha para staff e um plugin próprio de usuário/PIN para o lavador. O tenant é o `lava_jato` (organização do Better Auth); todo dado de domínio carrega `tenant_id`. A autorização real acontece no servidor: `requirePermission` (sessão → vínculo ativo → perfil → permissão) antes de qualquer leitura ou escrita; o `proxy.ts` só redireciona quem não tem cookie.

Fluxo de uma action da equipe: `equipe-form.tsx` → `equipe.actions.ts` (permissão base, schema estrito) → `equipe.service.ts` (revalida ator/alvo em transação) → `equipe.repo.ts`/Drizzle.

## Raiz

| Arquivo | Papel |
|---|---|
| `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `.node-version` | Dependências fixadas, scripts, Node 24.x / pnpm 11.x |
| `compose.yaml` | Postgres 16 local em `127.0.0.1:55432` |
| `.env.example` | Variáveis do app (cópia para `.env.local`, ignorado pelo git) |
| `next.config.ts`, `tsconfig.json`, `eslint.config.mjs`, `postcss.config.mjs` | Configuração de build, tipos, lint e Tailwind |
| `drizzle.config.ts` | drizzle-kit com a role de DDL (`MIGRATION_DATABASE_URL`) |
| `vitest.config.ts` | Projetos `unit` e `integration` em sequência, arquivos em série |
| `playwright.config.ts` | E2E desktop/mobile contra o build standalone em `:3100`, `LAVAOS_MODE=test`, URL do banco de `tests/helpers/test-db.ts` |
| `.github/workflows/quality.yml` | CI: Postgres 16 de serviço, roles via `scripts/db-local-init.sql`, migrations, `pnpm verify:foundation` |
| `README.md` | Ambiente, URLs, migrations, seed, equipe, qualidade, limites e notas de produção |

## `drizzle/`

| Arquivo | Papel |
|---|---|
| `0000_fundacao.sql` | Tabelas Better Auth (`user`, `session`, `account`, `verification`), `lava_jatos`, `membros`, `convites`, `credenciais_lavador` (sem grants: o DML do `lavaos_app` vem do `ALTER DEFAULT PRIVILEGES` em `db-local-init.sql`) |
| `0001_org_plugin_campos.sql` | Colunas `logo`/`metadata` exigidas pelo plugin de organização |
| `0002_pin_sessao_e_limite_origem.sql` | Vínculo sessão ↔ credencial PIN (`pin_member_id`, `pin_credential_version`) e limite de tentativas por origem |
| `meta/` | Journal e snapshots do drizzle-kit |

## `scripts/`

| Arquivo | Papel |
|---|---|
| `db-local-init.sql` | Roles `lavaos_owner` (DDL) e `lavaos_app` (DML), bancos `lavaos_dev`/`lavaos_test` (compose e CI) |
| `seed-dev.ts` | `pnpm db:seed:dev`: tenant + dono local; recusa produção e bancos não locais |
| `verify-foundation.ts` | `pnpm verify:foundation`: lint → typecheck → test → build → E2E, falha imediata, recusa testes `.only/.skip` |

## `src/`

### `app/` (rotas)

| Arquivo | Papel |
|---|---|
| `layout.tsx`, `globals.css` | Layout raiz (pt-BR) e tema Tailwind |
| `page.tsx` | `/` leva ao início com sessão válida, senão ao login |
| `login/page.tsx` | Tela de login (staff e lavador) |
| `(interno)/layout.tsx` | Layout protegido: exige contexto de tenant, senão `/login?motivo=sessao` |
| `(interno)/inicio/page.tsx` | Início para os quatro perfis |
| `(interno)/configuracoes/equipe/page.tsx` | Equipe; sem `equipe:gerenciar` mostra "Acesso negado" sem ler dados |
| `api/auth/[...all]/route.ts` | Handler Better Auth atrás da whitelist HTTP |

### `components/`

| Arquivo | Papel |
|---|---|
| `app-shell.tsx` | Cabeçalho/navegação por perfil e rótulos dos perfis |
| `login-form.tsx` | Formulário com modo e-mail/senha ou usuário/PIN, escolha de lava jato |
| `equipe-form.tsx` | Lista, cadastro, redefinição de PIN e desativação |
| `ui/button.tsx`, `ui/input.tsx`, `ui/label.tsx` | Primitivos de UI |

### `lib/`

| Arquivo | Papel |
|---|---|
| `env.ts` | Validação lazy das variáveis; `TEST_DATABASE_URL` só `lavaos_test` local |
| `utils.ts` | `cn` para classes |
| `db/client.ts`, `db/types.ts` | Pool Postgres compartilhado e tipo `Database` |
| `db/schema/auth.ts`, `equipe.ts`, `credenciais.ts`, `index.ts` | Schema Drizzle (auth, tenant/membros/convites, credenciais e tentativas de PIN) |
| `auth/server.ts` | Instância Better Auth (organização, PIN, hooks de vínculo, IP só de `X-Real-IP`) |
| `auth/client.ts` | Cliente do navegador |
| `auth/route-policy.ts` | Whitelist de `/api/auth/*` e destinos pós-login permitidos |
| `auth/context.ts` | `requireTenantContext`/`requirePermission`: sessão → vínculo ativo → permissão |
| `auth/permissions.ts`, `auth/types.ts` | Matriz perfil × permissão, `AcessoNegadoError`, tipos do contexto |
| `auth/pin.plugin.ts`, `pin.repo.ts`, `pin.rules.ts` | Login por usuário/PIN, bloqueio persistente (5 erros / 15 min) e limite por origem |
| `auth/credentials.ts` | Hash/verificação de segredos com o scrypt do Better Auth |

### `modules/equipe/`

| Arquivo | Papel |
|---|---|
| `equipe.actions.ts` | Server actions `createMemberAction`, `deactivateMemberAction`, `resetPinAction` |
| `equipe.schemas.ts` | Schemas Zod estritos (campo extra, como `tenantId`, é recusado) |
| `equipe.service.ts` | Regras transacionais: liderança, último dono, revogação de sessões, versão do PIN |
| `equipe.repo.ts`, `equipe.rules.ts` | Consultas filtradas por tenant e regras puras de quem gerencia quem |

### `proxy.ts`

Redirecionamento otimista ao login de quem não tem cookie em `/inicio` e `/configuracoes/*`.

## `tests/`

| Pasta / arquivo | Papel |
|---|---|
| `unit/` (5) | Rotas auth, env, regras de equipe, permissões, regras de PIN |
| `integration/` (9) | Schema/constraints, guards, contexto de tenant, auth staff e PIN, actions/repo da equipe, revogação de sessão, seed-dev — Postgres real em `lavaos_test` |
| `e2e/foundation-login.spec.ts` | Login dos perfis, retorno seguro, acessibilidade, escolha de lava jato |
| `e2e/foundation-equipe.spec.ts` | Gestão de equipe pela UI, reset/bloqueio de PIN, desativação com sessão aberta |
| `e2e/foundation-security.spec.ts` | Aceitação adversarial por HTTP real: actions com alvo de outro tenant, reenvio por perfis sem permissão, cadastro/organização bloqueados, cookie antigo após desativação/reset; confere ausência de escrita |
| `e2e/global-setup.ts`, `e2e/login.ts` | Zera `lavaos_test`, migra e cria tenants A/B com segredos por execução; helpers de login |
| `helpers/test-db.ts` | Fonte única das URLs do banco de testes e trava `assertTestDb` |
| `helpers/db.ts`, `fixtures.ts`, `auth.ts`, `http.ts`, `empty.ts` | Banco descartável por teste, fixtures A/B, cliente HTTP do handler auth, stub de `server-only` |

## Fora desta fase

Não há tabelas, telas nem módulos de operação (catálogo, clientes, OS, fila), painel ou financeiro (caixa, comissões). Ordem das fases: 0 Fundação → 1 Operação → 2 Painel → 3 App nativo → 4 Dinheiro → 5 Comissões → 6 Gestão → 7 Avaliação → 8 Produção → 9 Fidelidade.
