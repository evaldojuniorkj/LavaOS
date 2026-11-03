# Imagem de produção: app (`node server.js`) e migrations (`node scripts/migrate.ts`) na mesma imagem.
# NODE_VERSION acompanha .node-version (a CI passa o valor do arquivo; manter o padrão igual).
ARG NODE_VERSION=24.19.0

FROM node:${NODE_VERSION}-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# pnpm vem de packageManager; COREPACK_ENABLE_DOWNLOAD_PROMPT=0 evita a pergunta interativa
RUN COREPACK_ENABLE_DOWNLOAD_PROMPT=0 pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:${NODE_VERSION}-alpine
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=build --chown=node:node /app/scripts/migrate.ts ./scripts/migrate.ts
# o standalone traça o pg mas não o drizzle-orm (vai embutido no bundle do app); o script precisa dele
COPY --from=build --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
USER node
EXPOSE 3000
CMD ["node", "server.js"]
