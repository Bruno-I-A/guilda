# syntax=docker/dockerfile:1

FROM node:22-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# Placeholders APENAS para o build (todas as páginas são dinâmicas —
# nenhuma conexão acontece). Os valores reais entram em runtime.
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ENV BETTER_AUTH_SECRET=placeholder-somente-para-o-build-32ch
ENV BETTER_AUTH_URL=http://localhost:4000
# Garante que public/ exista mesmo sem nenhum asset: o Git nao versiona
# diretorio vazio e o COPY do estagio runner falharia sem ela.
RUN mkdir -p public
RUN npm run build

# Roda as migrations do Drizzle (precisa das devDependencies)
FROM base AS migrator
COPY --from=deps /app/node_modules ./node_modules
COPY package.json drizzle.config.ts ./
COPY src/db ./src/db
CMD ["npx", "drizzle-kit", "migrate"]

# Imagem final enxuta com o output standalone do Next
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S nodejs && adduser -S nextjs -G nodejs
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=build --chown=nextjs:nodejs /app/tsconfig.json ./tsconfig.json
COPY --from=build --chown=nextjs:nodejs /app/src ./src
COPY --from=build --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=build --chown=nextjs:nodejs /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=build --chown=nextjs:nodejs /app/package.json ./package.json
USER nextjs
EXPOSE 4000
ENV PORT=4000
ENV HOSTNAME=0.0.0.0
# O painel de hospedagem constrói somente este Dockerfile (não o Compose).
# O supervisor inicia a aplicação e o consumidor de updates do Telegram no
# mesmo serviço, propagando sinais e reiniciando o container se um deles cair.
CMD ["node", "scripts/start-production.mjs"]
