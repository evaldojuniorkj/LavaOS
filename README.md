# LavaOS
Projeto de um SAAS para Lava jato.

Estado atual: **Fase 2 — Painel** concluída sobre a Fase 1 — Operação e a Fase 0 — Fundação. Na Fase 1 o pátio já funciona: catálogo, clientes e veículos, ordens de serviço, fila em tempo real, link público de acompanhamento, avisos por WhatsApp, app do lavador (PWA Android) e assistente de primeiro acesso. Caixa e comissões chegam nas fases seguintes (veja [Limites da Fase 1](#limites-da-fase-1)).

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
| `http://localhost:3000/fila` | Fila em tempo real (Aguardando, Em lavagem, Pronto) para dono, gerente e recepção; o lavador é levado a `/lavador` |
| `http://localhost:3000/nova-os` | Nova OS pela placa (veículo existente ou cadastro rápido), serviços e responsável opcional |
| `http://localhost:3000/clientes` | Clientes e veículos |
| `http://localhost:3000/configuracoes/catalogo` | Portes, serviços, adicionais, preços por porte e comissão por serviço |
| `http://localhost:3000/configuracoes/equipe` | Gestão da equipe (dono e gerente); demais perfis veem "Acesso negado" |
| `http://localhost:3000/lavador` e `/lavador/nova` | App do lavador (PWA): fila com Pegar / Iniciar lavagem / Pronto e Nova lavagem; sem nenhum valor em R$ |
| `http://localhost:3000/acompanhar/<token>` | Página pública do cliente (sem login), atualizada ao vivo |
| `http://localhost:3000/primeiro-acesso` | Assistente de instalação; 404 sem `LAVAOS_SETUP_TOKEN` |
| `http://localhost:3000/api/eventos`, `/api/acompanhar/<token>/eventos` | Streams SSE da fila (com sessão) e da página pública |
| `http://localhost:3000/api/auth/*` | Protocolo Better Auth, restrito a uma whitelist (`src/lib/auth/route-policy.ts`); cadastro público e rotas de organização respondem 404 |

## Migrations

`pnpm db:migrate` aplica as migrations versionadas em `drizzle/` usando `MIGRATION_DATABASE_URL` (role `lavaos_owner`). O app roda com `DATABASE_URL` (role `lavaos_app`, sem DDL). Nova migration: alterar `src/lib/db/schema/`, rodar `pnpm db:generate` e revisar o SQL gerado; nunca `drizzle-kit push`.

## Dados de desenvolvimento (`seed-dev`)

`pnpm db:seed:dev` cria o tenant `LAVAOS_PILOT_SLUG` e um dono (`SEED_OWNER_EMAIL`, `SEED_OWNER_NOME`, `SEED_TENANT_NOME` opcionais). A senha vem de `SEED_OWNER_PASSWORD` ou é digitada sem eco. Só roda com `LAVAOS_MODE` development/test contra `lavaos_dev`/`lavaos_test` locais; reexecutar não altera credenciais existentes. **Nunca é executado em produção nem no CI.**

## Fase 1 — Operação

- **Catálogo** (`/configuracoes/catalogo`, dono e gerente): portes, serviços principais e adicionais, preço por porte em centavos e comissão obrigatória por serviço (percentual ou valor fixo; o cálculo da comissão é da Fase 5).
- **Clientes e veículos** (`/clientes`): placa normalizada (`ABC-1D23` → `ABC1D23`, padrões antigo e Mercosul), telefone em E.164.
- **Ordem de serviço** (`/nova-os`): busca pela placa ou cadastro rápido; ao menos um serviço principal (adicional só junto de um principal); o total vem do servidor a partir dos preços, que ficam copiados na OS. Um único responsável, opcional na abertura, com sugestão de lavador livre (só orientação). Status `aguardando → em_lavagem → pronto → entregue`, ou `cancelada` com motivo; entregue e cancelada são definitivas e somente leitura. Enquanto a OS está ativa, dono, gerente e recepção corrigem os itens; desconto e acréscimo são só de dono e gerente.
- **Fila em tempo real** (`/fila`): cada mudança gera `pg_notify` na mesma transação; o servidor repassa por SSE só ids e tipo do evento e cada tela recarrega a visão do seu perfil. Duas pessoas agindo na mesma OS: uma vence, a outra vê a mensagem (ex.: "Essa OS já foi pega por …") e a tela recarrega.
- **Link público** (`/acompanhar/<token>`): status, linha do tempo, serviços e total, sem nomes da equipe; ao vivo enquanto aberto; token de 32 bytes que expira 7 dias após a entrega ou cancelamento; link inválido ou expirado mostra sempre a mesma página genérica.
- **WhatsApp**: botões "Enviar acompanhamento" e "Avisar pronto" abrem `wa.me` com a mensagem pronta (placa, link, total); sem telefone, o botão pede e salva no cliente. Nada é enviado automaticamente.
- **App do lavador** (`/lavador`): pensado para Android de 360–412 px, uma mão, botões ≥ 48 px, vibração ao confirmar quando o aparelho suporta, tela acesa (Wake Lock) enquanto aberto. O lavador vê só os nomes dos clientes e nunca valores em R$, telefone ou comissão.
- **Assistente de primeiro acesso** (`/primeiro-acesso`): abaixo.

## Fase 2 — Painel

- **Painel** (`/painel`, permissão `painel:ver`: dono, gerente e recepção): contagens de Aguardando, Em lavagem, Pronto e Entregues hoje, tempo médio de lavagem, lavadores livres/ocupados e OSs atrasadas. Ao vivo por SSE (mais uma recarga a cada 60 s); sem valores em R$, telefone nem link público. Dono e gerente começam no painel, recepção na fila, lavador em `/lavador`.
- **Atraso:** OS aguardando ou em lavagem há mais de 60 min (aguardando conta da entrada; em lavagem, do início da lavagem).
- **"Dia"** (Entregues hoje) é o dia civil em America/Sao_Paulo.
- **Veículo sem placa:** a OS pode abrir sem placa (modelo de 2 a 40 caracteres identifica o carro).
- **Testes:** unit/integration e E2E dividem `lavaos_test`; um lock mútuo (advisory) impede duas suítes de rodarem ao mesmo tempo.
- **Redesign de app:** menu lateral no desktop, abas inferiores no celular, placa Mercosul e cores por status.
- Recebido do dia e caixa aberto/fechado ficam para a Fase 4.

### Rodar e popular

Mesmos passos de [Ambiente](#ambiente). `pnpm db:seed:dev` cria só o lava jato e o dono; o catálogo (portes, serviços e preços), a equipe e os clientes são cadastrados pelas telas — ou, num banco vazio, pelo assistente de primeiro acesso, que já cria os portes e serviços de exemplo.

### Instalar o app do lavador

- **Android (Chrome):** entre em `/login` com usuário e PIN, abra o menu ⋮ do Chrome e toque em **Instalar app** (ou **Adicionar à tela inicial**); quando o Chrome oferece, o próprio app mostra o botão **Instalar no celular**. O app abre direto em `/lavador`, em tela cheia. Precisa de HTTPS (em produção) ou `localhost`.
- **iPhone (Safari):** botão **Compartilhar** → **Adicionar à Tela de Início**. Funciona, mas sem vibração e sem botão de instalar dentro do app.

### Variáveis novas

| Variável | Para quê |
|---|---|
| `LAVAOS_SETUP_TOKEN` | Código de instalação do assistente `/primeiro-acesso` (mín. 16 caracteres). Sem ele o assistente responde 404. Defina só para instalar e remova depois. |
| `BETTER_AUTH_URL` | Já existia; em produção **precisa** ser a origem pública `https://…` do sistema, porque monta os links de acompanhamento enviados ao cliente pelo WhatsApp. |

## Primeiro acesso (instalação)

Num banco sem lava jato, `/primeiro-acesso` cria o lava jato (slug = `LAVAOS_PILOT_SLUG`), o dono, os 4 portes padrão e serviços de exemplo **inativos e sem preço** (defina os preços e ative em Configurações > Catálogo). O assistente só existe com `LAVAOS_SETUP_TOKEN` definido (mín. 16 caracteres); sem ele a página responde 404. O formulário pede esse código de instalação (5 tentativas por IP a cada 15 minutos). Depois do cadastro a página redireciona ao login; remova o `LAVAOS_SETUP_TOKEN` do servidor.

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
| `pnpm test:e2e` | Playwright (projetos desktop, mobile, android/android-small para o app do lavador e onboarding-desktop/onboarding-mobile para o assistente): compila, zera `lavaos_test`, cria as fixtures e sobe o servidor standalone em `http://localhost:3100` com `LAVAOS_MODE=test` (e um segundo, em `:3101`, com o assistente de primeiro acesso ligado sobre o schema vazio `onboarding` do mesmo banco); encerra o servidor ao fim |
| `pnpm verify:operacao` | lint → typecheck → test → build → E2E, parando no primeiro erro; o E2E reaproveita o build recém-feito; recusa testes marcados `.only/.skip/.todo/.fixme`, `skipIf/runIf`, `concurrent.skip`, `xit/xdescribe/fit` |
| `pnpm verify:foundation` | Alias do mesmo script (mesmo gate) |

Integração e E2E **zeram** `lavaos_test` e rodam em série (nunca em paralelo entre si). A URL vem de uma só fonte, `tests/helpers/test-db.ts` (padrões do compose ou `TEST_DATABASE_URL`/`MIGRATION_DATABASE_URL` do `.env.local`), e a limpeza só aceita o banco `lavaos_test` em `localhost`/`127.0.0.1`/`[::1]`. O E2E gera a cada execução o `BETTER_AUTH_SECRET`, as senhas e o PIN das fixtures; traces só ficam em `test-results/` local (ignorado pelo git) e são desligados no CI.

CI: `.github/workflows/quality.yml` (Node de `.node-version`, pnpm de `packageManager`, `--frozen-lockfile`, Postgres 16 como serviço em `127.0.0.1:55432`, roles/bancos via `scripts/db-local-init.sql`, migrations, browsers do Playwright e `pnpm verify:operacao`). Nenhum artefato de teste é publicado. **A CI ainda não foi executada no GitHub**: o workflow só foi validado localmente (sintaxe YAML e os mesmos comandos).

## Limites da Fase 1

A Fase 1 controla o pátio. **Não existem ainda**: app nativo (Fase 3), pagamento, caixa e quitação antes da entrega (Fase 4 — aqui "Entregar" não valida pagamento), geração de comissões (Fase 5; a comissão só é cadastrada e copiada na OS), agenda e relatórios (Fase 6), avaliação (Fase 7), produção/deploy (Fase 8) e fidelidade (Fase 9). Também fora: reabrir OS entregue, dividir uma OS entre lavadores e WhatsApp automático (só links `wa.me`).

0 Fundação → 1 Operação → 2 Painel → 3 App nativo → 4 Dinheiro → 5 Comissões → 6 Gestão → 7 Avaliação → 8 Produção → 9 Fidelidade.

## Notas de produção (Fase 8)

Itens acumulados nas revisões das Fases 0 e 1, a resolver no deploy:

- O proxy reverso deve **sobrescrever** `X-Real-IP` com o endereço do socket (nginx: `proxy_set_header X-Real-IP $remote_addr`), e o app deve ouvir só atrás dele (loopback). O limite de PIN por origem e os limites da página pública, do SSE público e do assistente confiam nesse cabeçalho.
- A imagem Docker do build `standalone` precisa copiar `public/` e `.next/static` para junto do `server.js` (como faz o `playwright.config.ts`); sem isso ícones e manifest dão 404 e o PWA não instala.
- O access log do nginx grava o token completo de `/acompanhar/<token>` e `/api/acompanhar/<token>/eventos`: mascarar o token no `log_format` ou aceitar o risco (o link expira 7 dias após a entrega/cancelamento).
- `LAVAOS_SETUP_TOKEN`: gerar com ≥ 16 caracteres aleatórios (ex.: `openssl rand -base64 24`) e remover ou trocar logo após o primeiro acesso.
- Limites de taxa: o de PIN por origem é persistente (Postgres); os da página pública, do SSE público e do assistente ficam em memória, por processo (zeram no restart e não se somam entre réplicas).
- `BETTER_AUTH_URL` = origem pública `https://…` (monta os links enviados aos clientes).
- A revogação de sessão é global por usuário: desativar alguém em um lava jato derruba as sessões dele em todos.
- No CI, segredos de app/auth e senhas/PINs de teste são gerados por execução; já a senha do superusuário Postgres e as senhas das roles (`db-local-init.sql`) são valores descartáveis fixos, versionados no repositório, seguros só porque o container é descartado com o job e escuta apenas em loopback. Produção usa segredos próprios, nunca os de `.env.example`, do compose local ou do CI.
- A role de runtime (`lavaos_app`) tem só DML. Um banco de produção criado só com `db:migrate` não dá nenhum grant a ela, porque os grants vêm de `scripts/db-local-init.sql`, não das migrations: aplique os grants de `scripts/db-local-init.sql` (`GRANT USAGE` no schema e `ALTER DEFAULT PRIVILEGES` de DML para `lavaos_app`) ou equivalentes antes de subir o app.
- A CI (`.github/workflows/quality.yml`) nunca foi executada no GitHub: rodar e corrigir o que aparecer antes de depender dela.
