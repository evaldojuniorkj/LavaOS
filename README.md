# LavaOS
Projeto de um SAAS para Lava jato.

## Desenvolvimento local

Requisitos: Node 24.x e pnpm 11.x (versões em `.node-version` e `package.json`).

```bash
pnpm install
cp .env.example .env.local   # preencha os valores
pnpm dev                     # http://localhost:3000
```

Verificações: `pnpm lint`, `pnpm typecheck`, `pnpm test:unit`, `pnpm build`.

`pnpm dev` usa `next dev --webpack` (o HMR do Turbopack mostrou-se instável); `build` usa o padrão do Next.

Banco local: `docker compose up -d --wait` (Postgres 16 em 127.0.0.1:55432; bancos `lavaos_dev` e `lavaos_test`), depois `pnpm db:migrate`. Testes de integração (zeram `lavaos_test`): `pnpm test:integration`. Novas migrations: `pnpm db:generate` e revisar o SQL; nunca `drizzle-kit push`.

Dados locais: `pnpm db:seed:dev` cria o tenant `LAVAOS_PILOT_SLUG` e um dono (`SEED_OWNER_EMAIL`, `SEED_OWNER_NOME`, `SEED_TENANT_NOME` opcionais). A senha vem de `SEED_OWNER_PASSWORD` ou é digitada sem eco. Só roda com `LAVAOS_MODE` development/test contra `lavaos_dev`/`lavaos_test` locais; reexecutar não altera credenciais existentes.

Equipe: desativar um membro apaga todas as sessões do usuário, inclusive em outro lava jato onde ele tenha vínculo (escolha conservadora do piloto; ele entra de novo lá). Resetar o PIN de um lavador incrementa a versão da credencial e derruba as sessões PIN dele.
