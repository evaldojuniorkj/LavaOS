# LavaOS
Projeto de um SAAS para Lava jato.

Estado atual: **Fase 0 — Fundação** (login, perfis, permissões, equipe mínima e infraestrutura de qualidade). Operação, painel e financeiro chegam nas fases seguintes (veja [Limites da Fundação](#limites-da-fundação)).

## Ambiente

- Node 24.x e pnpm 11.x (versões exatas em `.node-version` e `packageManager` do `package.json`).
- Docker, para o Postgres 16 local (`compose.yaml`, só em loopback `127.0.0.1:55432`).
- Next.js 16 (App Router) + TypeScript, Drizzle ORM, Better Auth, Tailwind CSS.

```bash
pnpm install --frozen-lockfile
cp .env.example .env.local     # preencha BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d --wait    # cria lavaos_dev e lavaos_test com as roles lavaos_owner (DDL) e lavaos_app (DML)
pnpm db:migrate                # aplica drizzle/*.sql em lavaos_dev com a role de DDL
pnpm db:seed:dev               # tenant + dono de desenvolvimento (abaixo)
pnpm dev                       # http://localhost:3000
```

`pnpm dev` usa `next dev --webpack` (o HMR do Turbopack mostrou-se instável); `build` usa o padrão do Next e gera `output: standalone`.

## URLs

| URL | O quê |
|---|---|
| `http://localhost:3000/login` | Login: e-mail e senha (dono, gerente, recepção) ou usuário e PIN (lavador) |
| `http://localhost:3000/inicio` | Início, para os quatro perfis |
| `http://localhost:3000/configuracoes/equipe` | Gestão da equipe (dono e gerente); demais perfis veem "Acesso negado" |
| `http://localhost:3000/api/auth/*` | Protocolo Better Auth, restrito a uma whitelist (`src/lib/auth/route-policy.ts`); cadastro público e rotas de organização respondem 404 |

## Migrations

`pnpm db:migrate` aplica as migrations versionadas em `drizzle/` usando `MIGRATION_DATABASE_URL` (role `lavaos_owner`). O app roda com `DATABASE_URL` (role `lavaos_app`, sem DDL). Nova migration: alterar `src/lib/db/schema/`, rodar `pnpm db:generate` e revisar o SQL gerado; nunca `drizzle-kit push`.

## Dados de desenvolvimento (`seed-dev`)

`pnpm db:seed:dev` cria o tenant `LAVAOS_PILOT_SLUG` e um dono (`SEED_OWNER_EMAIL`, `SEED_OWNER_NOME`, `SEED_TENANT_NOME` opcionais). A senha vem de `SEED_OWNER_PASSWORD` ou é digitada sem eco. Só roda com `LAVAOS_MODE` development/test contra `lavaos_dev`/`lavaos_test` locais; reexecutar não altera credenciais existentes. **Nunca é executado em produção nem no CI.**

## Login e gestão de equipe

- Dono, gerente e recepção entram por e-mail e senha; quem tem vínculo com mais de um lava jato escolhe um antes de entrar.
- Lavador entra por usuário e PIN numérico de 4 a 6 dígitos (zero inicial preservado); sessão de 30 dias; 5 PINs errados seguidos bloqueiam por 15 minutos, com a mesma mensagem de erro em todos os casos.
- Em **Equipe**, o dono cadastra qualquer perfil; o gerente cadastra e gerencia só recepção e lavador. Ações: cadastrar, redefinir PIN (lavador) e desativar. Toda decisão é revalidada no servidor (`requirePermission` + serviço).
- Desativar um membro apaga todas as sessões do usuário, inclusive em outro lava jato onde ele tenha vínculo (escolha conservadora do piloto; ele entra de novo lá). Resetar o PIN incrementa a versão da credencial e derruba as sessões PIN do lavador.

## Comandos de qualidade

| Comando | O quê |
|---|---|
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm test` | Vitest: projetos `unit` e depois `integration` (`pnpm test:unit`, `pnpm test:integration` para um só) |
| `pnpm test:e2e` | Playwright (desktop e mobile): compila, zera `lavaos_test`, cria as fixtures e sobe o servidor standalone em `http://localhost:3100` com `LAVAOS_MODE=test`; encerra o servidor ao fim |
| `pnpm verify:foundation` | lint → typecheck → test → build → E2E, parando no primeiro erro; o E2E reaproveita o build recém-feito; recusa testes marcados `.only/.skip/.todo/.fixme` |

Integração e E2E **zeram** `lavaos_test` e rodam em série (nunca em paralelo entre si). A URL vem de uma só fonte, `tests/helpers/test-db.ts` (padrões do compose ou `TEST_DATABASE_URL`/`MIGRATION_DATABASE_URL` do `.env.local`), e a limpeza só aceita o banco `lavaos_test` em `localhost`/`127.0.0.1`/`[::1]`. O E2E gera a cada execução o `BETTER_AUTH_SECRET`, as senhas e o PIN das fixtures; traces só ficam em `test-results/` local (ignorado pelo git) e são desligados no CI.

CI: `.github/workflows/quality.yml` (Node de `.node-version`, pnpm de `packageManager`, `--frozen-lockfile`, Postgres 16 como serviço em `127.0.0.1:55432`, roles/bancos via `scripts/db-local-init.sql`, migrations, browsers do Playwright e `pnpm verify:foundation`). Nenhum artefato de teste é publicado.

## Limites da Fundação

A Fundação entrega só o necessário para provar o acesso dos perfis: tenant (`lava_jatos`), membros, credenciais de lavador, sessões e a tela de equipe. **Operação** (catálogo, clientes/veículos, OS, fila em tempo real, PWA, assistente de primeiro acesso) e **financeiro** (caixa, despesas, comissões) não existem ainda — nem tabelas, nem telas — e chegam nas próximas fases:

0 Fundação → 1 Operação → 2 Painel → 3 App nativo → 4 Dinheiro → 5 Comissões → 6 Gestão → 7 Avaliação → 8 Produção → 9 Fidelidade.

## Notas de produção (Fase 8)

- O proxy reverso deve **sobrescrever** `X-Real-IP` com o endereço do socket (nginx: `proxy_set_header X-Real-IP $remote_addr`), e o app deve ouvir só atrás dele (loopback). O limite de PIN por origem confia nesse cabeçalho.
- A revogação de sessão é global por usuário: desativar alguém em um lava jato derruba as sessões dele em todos.
- Segredos do CI são efêmeros (gerados por execução, banco descartado com o job); produção usa segredos próprios, nunca os de `.env.example` ou do compose local.
