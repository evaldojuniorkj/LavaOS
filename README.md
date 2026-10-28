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
